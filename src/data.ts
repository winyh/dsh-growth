import type { FileSystemLike, GrowthConfig, Row } from './types.js'

function parseCsvLine(line: string): string[] {
  const cells: string[] = []
  let current = ''
  let quoted = false
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index]
    if (char === '"') {
      if (quoted && line[index + 1] === '"') {
        current += '"'
        index += 1
      } else {
        quoted = !quoted
      }
    } else if (char === ',' && !quoted) {
      cells.push(current.trim())
      current = ''
    } else {
      current += char
    }
  }
  cells.push(current.trim())
  return cells
}

function normalizeCell(value: unknown): string | number | boolean | null | undefined {
  if (value === undefined || value === null) return value as null | undefined
  if (typeof value !== 'string') return value as string | number | boolean
  const trimmed = value.trim()
  if (!trimmed) return ''
  if (trimmed === 'true') return true
  if (trimmed === 'false') return false
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed)
  return trimmed
}

export function parseCsv(content: string): Row[] {
  const lines = content.replace(/^\uFEFF/, '').split(/\r?\n/).filter((line) => line.trim().length > 0)
  if (lines.length === 0) return []
  const headers = parseCsvLine(lines[0] ?? '').map((header) => header.trim())
  return lines.slice(1).map((line) => {
    const cells = parseCsvLine(line)
    return Object.fromEntries(headers.map((header, index) => [header, normalizeCell(cells[index])]))
  })
}

function parseJson(content: string): Row[] {
  const parsed: unknown = JSON.parse(content)
  if (Array.isArray(parsed)) return parsed.filter((item): item is Row => typeof item === 'object' && item !== null && !Array.isArray(item))
  if (typeof parsed === 'object' && parsed !== null) return [parsed as Row]
  throw new Error('JSON dataset must be an object or an array of objects')
}

function parseJsonLines(content: string): Row[] {
  const rows: Row[] = []
  for (const [index, line] of content.split(/\r?\n/).entries()) {
    if (!line.trim()) continue
    const parsed: unknown = JSON.parse(line)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error(`JSONL line ${index + 1} is not an object`)
    rows.push(parsed as Row)
  }
  return rows
}

export function parseDataset(path: string, content: string, maxRows: number): { rows: Row[]; warnings: string[] } {
  const lower = path.toLowerCase()
  const warnings: string[] = []
  let rows: Row[]
  if (lower.endsWith('.csv')) rows = parseCsv(content)
  else if (lower.endsWith('.jsonl') || lower.endsWith('.ndjson')) rows = parseJsonLines(content)
  else if (lower.endsWith('.json')) rows = parseJson(content)
  else throw new Error(`Unsupported dataset format: ${path}`)
  if (rows.length > maxRows) {
    warnings.push(`Rows truncated from ${rows.length} to configured maxRows ${maxRows}`)
    rows = rows.slice(0, maxRows)
  }
  if (rows.length === 0) warnings.push('Dataset contains no rows')
  return { rows, warnings }
}

export async function readDataset(fs: FileSystemLike, config: GrowthConfig, path: string, signal?: AbortSignal): Promise<{ source: string; rows: Row[]; warnings: string[] }> {
  const target = await fs.resolve(path, { signal })
  const info = await fs.stat(target, signal)
  if (!info || info.type !== 'file') throw new Error(`Dataset not found: ${path}`)
  if ((info.size ?? 0) > config.maxFileBytes) throw new Error(`Dataset exceeds maxFileBytes (${config.maxFileBytes})`)
  const content = await fs.readText(target, signal)
  if (content.length > config.maxTextChars) throw new Error(`Dataset exceeds maxTextChars (${config.maxTextChars})`)
  const parsed = parseDataset(path, content, config.maxRows)
  return { source: path, ...parsed }
}

export function value(row: Row, key: string | undefined): unknown {
  if (!key) return undefined
  return row[key]
}

export function stringValue(row: Row, key: string | undefined): string | undefined {
  const current = value(row, key)
  if (current === undefined || current === null || current === '') return undefined
  return String(current)
}

export function numberValue(row: Row, key: string | undefined): number | undefined {
  const current = value(row, key)
  if (typeof current === 'number' && Number.isFinite(current)) return current
  if (typeof current === 'string' && current.trim() && Number.isFinite(Number(current))) return Number(current)
  return undefined
}

export function dateValue(row: Row, key: string | undefined): Date | undefined {
  const current = stringValue(row, key)
  if (!current) return undefined
  const date = new Date(current)
  return Number.isNaN(date.getTime()) ? undefined : date
}
