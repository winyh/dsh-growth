import { dateValue, stringValue } from './data.js'
import { percentage, safeDivide } from './metrics.js'
import type { FunnelAnalysis, FunnelStageResult, Row } from './types.js'

export interface FunnelOptions {
  stages: Array<{ name: string; event: string }>
  userField: string
  eventField: string
  channelField?: string
  segmentField?: string
  timeField?: string
  start?: string
  end?: string
  sequenceMode?: 'any-event' | 'ordered'
  conversionWindowDays?: number
  attribution?: 'first-touch' | 'last-touch' | 'entry-touch'
  timezone?: string
}
interface TimelineEvent {
  event: string
  rowIndex: number
  time: number | null
}

function stageForAnyEvent(rows: Row[], options: FunnelOptions): FunnelStageResult[] {
  const usersByEvent = new Map<string, Set<string>>()
  for (const stage of options.stages) usersByEvent.set(stage.event, new Set())
  for (const row of rows) {
    const user = stringValue(row, options.userField)
    const event = stringValue(row, options.eventField)
    if (!user || !event || !usersByEvent.has(event)) continue
    usersByEvent.get(event)?.add(user)
  }
  return stageResults(usersByEvent, options.stages)
}

function stageResults(usersByEvent: Map<string, Set<string>>, stages: Array<{ name: string; event: string }>): FunnelStageResult[] {
  const entryCount = usersByEvent.get(stages[0]?.event ?? '')?.size ?? 0
  return stages.map((stage, index) => {
    const users = usersByEvent.get(stage.event)?.size ?? 0
    const previous = index > 0 ? usersByEvent.get(stages[index - 1]?.event ?? '')?.size ?? 0 : entryCount
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

function stageForOrdered(rows: Row[], options: FunnelOptions): FunnelStageResult[] {
  const usersByStage = options.stages.map(() => new Set<string>())
  const stageEvents = new Set(options.stages.map((stage) => stage.event))
  const timelines = new Map<string, TimelineEvent[]>()
  rows.forEach((row, rowIndex) => {
    const user = stringValue(row, options.userField)
    const event = stringValue(row, options.eventField)
    if (!user || !event || !stageEvents.has(event)) return
    const date = dateValue(row, options.timeField ?? 'timestamp') ?? dateValue(row, 'date') ?? dateValue(row, 'occurred_at')
    const timeline = timelines.get(user) ?? []
    timeline.push({ event, rowIndex, time: date?.getTime() ?? null })
    timelines.set(user, timeline)
  })
  for (const [user, timeline] of timelines) {
    timeline.sort((left, right) => left.rowIndex - right.rowIndex)
    let lastIndex = -1
    let entryTime: number | null = null
    for (const [stageIndex, stage] of options.stages.entries()) {
      const match = timeline.find((item) => {
        if (item.event !== stage.event || item.rowIndex <= lastIndex) return false
        if (stageIndex > 0 && options.conversionWindowDays !== undefined && entryTime !== null && item.time !== null) {
          return item.time - entryTime <= options.conversionWindowDays * 86_400_000
        }
        return true
      })
      if (!match) break
      usersByStage[stageIndex]?.add(user)
      lastIndex = match.rowIndex
      if (stageIndex === 0) entryTime = match.time
    }
  }
  const usersByEvent = new Map(options.stages.map((stage, index) => [stage.event, usersByStage[index] ?? new Set<string>()]))
  return stageResults(usersByEvent, options.stages)
}

function stageForRows(rows: Row[], options: FunnelOptions): FunnelStageResult[] {
  return options.sequenceMode === 'ordered' ? stageForOrdered(rows, options) : stageForAnyEvent(rows, options)
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

function attributedGroups(rows: Row[], options: FunnelOptions): Record<string, Row[]> {
  if (!options.channelField) return {}
  const attribution = options.attribution ?? 'entry-touch'
  const timelines = new Map<string, Array<{ row: Row; index: number; time: number | null; event?: string }>>()
  rows.forEach((row, index) => {
    const user = stringValue(row, options.userField)
    if (!user) return
    const timeline = timelines.get(user) ?? []
    const date = dateValue(row, options.timeField ?? 'timestamp') ?? dateValue(row, 'date') ?? dateValue(row, 'occurred_at')
    timeline.push({ row, index, time: date?.getTime() ?? null, event: stringValue(row, options.eventField) })
    timelines.set(user, timeline)
  })
  const groups: Record<string, Row[]> = {}
  for (const timeline of timelines.values()) {
    const ordered = timeline.toSorted((left, right) => left.index - right.index)
    const first = ordered[0]
    const last = ordered.at(-1)
    const entry = ordered.find((item) => item.event === options.stages[0]?.event) ?? first
    const selected = attribution === 'first-touch' ? first : attribution === 'last-touch' ? last : entry
    const channel = selected ? stringValue(selected.row, options.channelField) ?? 'unknown' : 'unknown'
    groups[channel] ??= []
    groups[channel].push(...ordered.map((item) => item.row))
  }
  return groups
}

export function analyzeFunnel(source: string, rows: Row[], options: FunnelOptions): FunnelAnalysis {
  const warnings: string[] = []
  if (options.stages.length < 2) warnings.push('At least two funnel stages are required for conversion analysis')
  const timeField = options.timeField ?? 'timestamp'
  const filtered = rows.filter((row) => {
    const date = dateValue(row, timeField) ?? dateValue(row, 'date') ?? dateValue(row, 'occurred_at')
    const start = options.start ? new Date(options.start) : undefined
    const end = options.end ? new Date(options.end) : undefined
    if (!date || Number.isNaN(date.getTime())) return !start && !end
    return (!start || date >= start) && (!end || date <= end)
  })
  if (options.sequenceMode === 'ordered' && filtered.some((row) => stringValue(row, options.eventField) && !dateValue(row, timeField) && !dateValue(row, 'date') && !dateValue(row, 'occurred_at'))) {
    warnings.push(`Ordered funnel contains rows without a valid timestamp in '${timeField}'; row order is used as a fallback`)
  }
  if (options.conversionWindowDays !== undefined && options.conversionWindowDays <= 0) warnings.push('conversionWindowDays must be positive; the window was ignored')
  const users = new Set(filtered.map((row) => stringValue(row, options.userField)).filter((item): item is string => Boolean(item)))
  if (users.size === 0) warnings.push(`No usable user IDs found in field '${options.userField}'`)
  const stages = stageForRows(filtered, options)
  const candidates = stages.slice(1).filter((stage) => stage.dropOffFromPrevious !== null)
  const bottleneck = candidates.toSorted((left, right) => (right.dropOffFromPrevious ?? -1) - (left.dropOffFromPrevious ?? -1))[0] ?? null
  const channelGroups = options.channelField ? attributedGroups(filtered, { ...options, attribution: options.attribution ?? 'entry-touch' }) : {}
  const segmentGroups = grouped(filtered, options.segmentField)
  return {
    generatedAt: new Date().toISOString(),
    source,
    userCount: users.size,
    eventRows: filtered.length,
    sequenceMode: options.sequenceMode ?? 'any-event',
    attribution: options.attribution ?? 'entry-touch',
    conversionWindowDays: options.conversionWindowDays ?? null,
    timezone: options.timezone ?? 'UTC',
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
  const trimmed = value.trim()
  if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
    let parsed: unknown
    try {
      parsed = JSON.parse(trimmed)
    } catch {
      throw new Error('stages JSON is invalid; use [{"name":"Activation","event":"activated"}] or name=event pairs')
    }
    if (!Array.isArray(parsed)) throw new Error('stages JSON must be an array')
    const stages = parsed.flatMap((item) => {
      if (typeof item === 'string' && item.trim()) return [{ name: item.trim(), event: item.trim() }]
      if (typeof item === 'object' && item !== null && 'name' in item && 'event' in item) {
        const candidate = item as { name: unknown; event: unknown }
        const name = String(candidate.name).trim()
        const event = String(candidate.event).trim()
        return name && event ? [{ name, event }] : []
      }
      return []
    })
    if (stages.length !== parsed.length) throw new Error('Every stages item must have non-empty name and event values')
    return stages
  }
  return trimmed.split(',').map((item) => item.trim()).filter(Boolean).map((item) => {
    const [name, event] = item.split('=').map((part) => part.trim())
    return { name: name || event || item, event: event || name || item }
  })
}
