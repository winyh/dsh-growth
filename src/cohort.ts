import { dateValue, stringValue } from './data.js'
import { intervalIndex, normalizePeriod, percentage } from './metrics.js'
import type { CohortAnalysis, Row } from './types.js'

export interface CohortOptions {
  cohortEvent: string
  retentionEvent: string
  userField: string
  eventField: string
  timeField: string
  interval: 'day' | 'week' | 'month'
  maxPeriods: number
  timezone?: string
}

function periodDistance(left: string, right: string, interval: CohortOptions['interval']): number {
  if (interval === 'month') {
    const [leftYear = 0, leftMonth = 0] = left.split('-').map(Number)
    const [rightYear = 0, rightMonth = 0] = right.split('-').map(Number)
    return (rightYear - leftYear) * 12 + rightMonth - leftMonth
  }
  const leftDate = new Date(`${left}T00:00:00Z`)
  const rightDate = new Date(`${right}T00:00:00Z`)
  const days = Math.floor((rightDate.getTime() - leftDate.getTime()) / 86_400_000)
  return interval === 'week' ? Math.floor(days / 7) : days
}

export function analyzeCohorts(source: string, rows: Row[], options: CohortOptions): CohortAnalysis {
  const warnings: string[] = []
  const timezone = options.timezone ?? 'UTC'
  const cohortStarts = new Map<string, Date>()
  for (const row of rows) {
    if (stringValue(row, options.eventField) !== options.cohortEvent) continue
    const user = stringValue(row, options.userField)
    const date = dateValue(row, options.timeField)
    if (!user || !date) continue
    const existing = cohortStarts.get(user)
    if (!existing || date < existing) cohortStarts.set(user, date)
  }
  if (cohortStarts.size === 0) warnings.push(`No cohort users found for event '${options.cohortEvent}'`)

  const retained = new Map<string, Map<number, Set<string>>>()
  for (const row of rows) {
    if (stringValue(row, options.eventField) !== options.retentionEvent) continue
    const user = stringValue(row, options.userField)
    const date = dateValue(row, options.timeField)
    const start = user ? cohortStarts.get(user) : undefined
    if (!user || !date || !start) continue
    const index = intervalIndex(start, date, options.interval, timezone)
    if (index < 0 || index >= options.maxPeriods) continue
    const cohort = normalizePeriod(start, options.interval, timezone)
    retained.get(cohort)?.get(index)?.add(user)
      ?? (() => {
        const periods = retained.get(cohort) ?? new Map<number, Set<string>>()
        const users = periods.get(index) ?? new Set<string>()
        users.add(user)
        periods.set(index, users)
        retained.set(cohort, periods)
      })()
  }

  const cohortSizes = new Map<string, number>()
  for (const start of cohortStarts.values()) {
    const cohort = normalizePeriod(start, options.interval, timezone)
    cohortSizes.set(cohort, (cohortSizes.get(cohort) ?? 0) + 1)
  }
  const cohorts = Array.from(cohortSizes.entries()).sort(([left], [right]) => left.localeCompare(right)).map(([cohort, size]) => {
    const periods = retained.get(cohort) ?? new Map<number, Set<string>>()
    const cells = Array.from({ length: options.maxPeriods }, (_, period) => {
      const retainedUsers = periods.get(period)?.size ?? 0
      return {
        period,
        cohortSize: size,
        retainedUsers,
        retentionRate: percentage(retainedUsers / size),
      }
    })
    return { cohort, size, cells }
  })

  const lifecycle: Record<string, number> = { new: 0, retained: 0, resurrected: 0, dormant: 0 }
  const activeByUser = new Map<string, string[]>()
  for (const row of rows) {
    const user = stringValue(row, options.userField)
    const date = dateValue(row, options.timeField)
    if (!user || !date || stringValue(row, options.eventField) !== options.retentionEvent) continue
    const period = normalizePeriod(date, options.interval, timezone)
    activeByUser.set(user, [...(activeByUser.get(user) ?? []), period])
  }
  for (const periods of activeByUser.values()) {
    const unique = Array.from(new Set(periods)).sort()
    if (unique.length === 1) lifecycle.new = (lifecycle.new ?? 0) + 1
    else if (unique.length > 1) {
      const hasGap = unique.slice(1).some((period, index) => periodDistance(unique[index] ?? period, period, options.interval) > 1)
      if (hasGap) lifecycle.resurrected = (lifecycle.resurrected ?? 0) + 1
      else lifecycle.retained = (lifecycle.retained ?? 0) + 1
    }
  }
  lifecycle.dormant = Math.max(0, cohortStarts.size - activeByUser.size)
  if (activeByUser.size === 0) warnings.push(`No retention users found for event '${options.retentionEvent}'`)
  return {
    generatedAt: new Date().toISOString(),
    source,
    cohortEvent: options.cohortEvent,
    retentionEvent: options.retentionEvent,
    interval: options.interval,
    timezone,
    cohorts,
    lifecycle,
    warnings,
  }
}
