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

export function normalizePeriod(date: Date, interval: 'day' | 'week' | 'month'): string {
  const year = date.getUTCFullYear()
  const month = String(date.getUTCMonth() + 1).padStart(2, '0')
  if (interval === 'month') return `${year}-${month}`
  if (interval === 'day') return `${year}-${month}-${String(date.getUTCDate()).padStart(2, '0')}`
  const start = new Date(Date.UTC(year, date.getUTCMonth(), date.getUTCDate()))
  const day = start.getUTCDay() || 7
  start.setUTCDate(start.getUTCDate() - day + 1)
  return `${start.getUTCFullYear()}-${String(start.getUTCMonth() + 1).padStart(2, '0')}-${String(start.getUTCDate()).padStart(2, '0')}`
}

export function intervalIndex(start: Date, current: Date, interval: 'day' | 'week' | 'month'): number {
  const milliseconds = current.getTime() - start.getTime()
  if (interval === 'day') return Math.floor(milliseconds / 86_400_000)
  if (interval === 'week') return Math.floor(milliseconds / (7 * 86_400_000))
  return (current.getUTCFullYear() - start.getUTCFullYear()) * 12 + current.getUTCMonth() - start.getUTCMonth()
}

export function weightedAverage(values: Array<{ value: number; weight: number }>): number | null {
  const valid = values.filter((item) => Number.isFinite(item.value) && Number.isFinite(item.weight) && item.weight > 0)
  const weight = valid.reduce((sum, item) => sum + item.weight, 0)
  if (weight === 0) return null
  return valid.reduce((sum, item) => sum + item.value * item.weight, 0) / weight
}
