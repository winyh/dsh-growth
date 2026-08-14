export function safeDivide(numerator: number, denominator: number): number | null {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) return null
  return numerator / denominator
}

export function round(value: number | null, digits = 4): number | null {
  if (value === null || !Number.isFinite(value)) return value
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

export function percentage(value: number | null, digits = 2): number | null {
  const ratio = value === null ? null : value * 100
  return round(ratio, digits)
}

export function parseList(value: string | undefined): string[] {
  if (!value?.trim()) return []
  const trimmed = value.trim()
  if (trimmed.startsWith('[')) {
    try {
      const parsed: unknown = JSON.parse(trimmed)
      if (Array.isArray(parsed)) return parsed.map(String).map((item) => item.trim()).filter(Boolean)
    } catch {
      return trimmed.split(',').map((item) => item.trim()).filter(Boolean)
    }
  }
  return trimmed.split(',').map((item) => item.trim()).filter(Boolean)
}

interface CalendarParts {
  year: number
  month: number
  day: number
}

function calendarParts(date: Date, timezone: string): CalendarParts {
  if (timezone === 'UTC' || timezone === 'Etc/UTC') return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() }
  try {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date)
    const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))
    const year = Number(values.year)
    const month = Number(values.month)
    const day = Number(values.day)
    if ([year, month, day].every(Number.isFinite)) return { year, month, day }
  } catch {
    // The caller still receives a deterministic UTC result and a warning is added by higher-level tools.
  }
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() }
}

function dayStart(date: Date, timezone: string): Date {
  const parts = calendarParts(date, timezone)
  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day))
}

export function normalizePeriod(date: Date, interval: 'day' | 'week' | 'month', timezone = 'UTC'): string {
  const { year, month: monthNumber, day: dayNumber } = calendarParts(date, timezone)
  const month = String(monthNumber).padStart(2, '0')
  if (interval === 'month') return `${year}-${month}`
  if (interval === 'day') return `${year}-${month}-${String(dayNumber).padStart(2, '0')}`
  const start = new Date(Date.UTC(year, monthNumber - 1, dayNumber))
  const day = start.getUTCDay() || 7
  start.setUTCDate(start.getUTCDate() - day + 1)
  return `${start.getUTCFullYear()}-${String(start.getUTCMonth() + 1).padStart(2, '0')}-${String(start.getUTCDate()).padStart(2, '0')}`
}

export function intervalIndex(start: Date, current: Date, interval: 'day' | 'week' | 'month', timezone = 'UTC'): number {
  const startDay = dayStart(start, timezone)
  const currentDay = dayStart(current, timezone)
  if (interval === 'day') return Math.floor((currentDay.getTime() - startDay.getTime()) / 86_400_000)
  if (interval === 'week') return Math.floor((currentDay.getTime() - startDay.getTime()) / (7 * 86_400_000))
  const startParts = calendarParts(start, timezone)
  const currentParts = calendarParts(current, timezone)
  return (currentParts.year - startParts.year) * 12 + currentParts.month - startParts.month
}

export function weightedAverage(values: Array<{ value: number; weight: number }>): number | null {
  const valid = values.filter((item) => Number.isFinite(item.value) && Number.isFinite(item.weight) && item.weight > 0)
  const weight = valid.reduce((sum, item) => sum + item.weight, 0)
  if (weight === 0) return null
  return valid.reduce((sum, item) => sum + item.value * item.weight, 0) / weight
}
