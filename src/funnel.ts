import { dateValue, stringValue } from './data.js'
import { percentage, safeDivide } from './metrics.js'
import type { FunnelAnalysis, FunnelStageResult, Row } from './types.js'

export interface FunnelOptions {
  stages: Array<{ name: string; event: string }>
  userField: string
  eventField: string
  channelField?: string
  segmentField?: string
  start?: string
  end?: string
}

function stageForRows(rows: Row[], options: FunnelOptions): FunnelStageResult[] {
  const usersByEvent = new Map<string, Set<string>>()
  for (const stage of options.stages) usersByEvent.set(stage.event, new Set())
  for (const row of rows) {
    const user = stringValue(row, options.userField)
    const event = stringValue(row, options.eventField)
    if (!user || !event || !usersByEvent.has(event)) continue
    usersByEvent.get(event)?.add(user)
  }
  const entryCount = usersByEvent.get(options.stages[0]?.event ?? '')?.size ?? 0
  return options.stages.map((stage, index) => {
    const users = usersByEvent.get(stage.event)?.size ?? 0
    const previous = index > 0 ? usersByEvent.get(options.stages[index - 1]?.event ?? '')?.size ?? 0 : entryCount
    return {
      name: stage.name,
      event: stage.event,
      users,
      conversionFromPrevious: index === 0 ? 1 : percentage(safeDivide(users, previous)),
      conversionFromEntry: percentage(safeDivide(users, entryCount)),
      dropOffFromPrevious: index === 0 ? 0 : percentage(safeDivide(previous - users, previous)),
    }
  })
}

function grouped(rows: Row[], field: string | undefined): Record<string, Row[]> {
  if (!field) return {}
  const groups: Record<string, Row[]> = {}
  for (const row of rows) {
    const key = stringValue(row, field) ?? 'unknown'
    groups[key] ??= []
    groups[key].push(row)
  }
  return groups
}

export function analyzeFunnel(source: string, rows: Row[], options: FunnelOptions): FunnelAnalysis {
  const warnings: string[] = []
  if (options.stages.length < 2) warnings.push('At least two funnel stages are required for conversion analysis')
  const filtered = rows.filter((row) => {
    const date = dateValue(row, 'timestamp') ?? dateValue(row, 'date') ?? dateValue(row, 'occurred_at')
    const start = options.start ? new Date(options.start) : undefined
    const end = options.end ? new Date(options.end) : undefined
    if (!date || Number.isNaN(date.getTime())) return !start && !end
    return (!start || date >= start) && (!end || date <= end)
  })
  const users = new Set(filtered.map((row) => stringValue(row, options.userField)).filter((item): item is string => Boolean(item)))
  if (users.size === 0) warnings.push(`No usable user IDs found in field '${options.userField}'`)
  const stages = stageForRows(filtered, options)
  const candidates = stages.slice(1).filter((stage) => stage.dropOffFromPrevious !== null)
  const bottleneck = candidates.sort((left, right) => (right.dropOffFromPrevious ?? -1) - (left.dropOffFromPrevious ?? -1))[0] ?? null
  const channelGroups = grouped(filtered, options.channelField)
  const segmentGroups = grouped(filtered, options.segmentField)
  return {
    generatedAt: new Date().toISOString(),
    source,
    userCount: users.size,
    eventRows: filtered.length,
    stages,
    bottleneck,
    byChannel: Object.fromEntries(Object.entries(channelGroups).map(([key, group]) => [key, stageForRows(group, options)])),
    bySegment: Object.fromEntries(Object.entries(segmentGroups).map(([key, group]) => [key, stageForRows(group, options)])),
    warnings,
  }
}

export function parseStages(value: string | undefined): Array<{ name: string; event: string }> {
  if (!value?.trim()) return [
    { name: 'Acquisition', event: 'acquired' },
    { name: 'Activation', event: 'activated' },
    { name: 'Retention', event: 'retained' },
    { name: 'Referral', event: 'referred' },
    { name: 'Revenue', event: 'paid' },
  ]
  try {
    const parsed: unknown = JSON.parse(value)
    if (Array.isArray(parsed)) {
      return parsed.flatMap((item) => {
        if (typeof item === 'string') return [{ name: item, event: item }]
        if (typeof item === 'object' && item !== null && 'name' in item && 'event' in item) {
          const candidate = item as { name: unknown; event: unknown }
          return [{ name: String(candidate.name), event: String(candidate.event) }]
        }
        return []
      })
    }
  } catch {
    return value.split(',').map((item) => item.trim()).filter(Boolean).map((item) => {
      const [name, event] = item.split('=').map((part) => part.trim())
      return { name: name || event || item, event: event || name || item }
    })
  }
  return []
}
