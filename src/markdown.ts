import type { Frontmatter, GrowthNote, MarkdownTable } from './types.js'

function scalar(value: string): unknown {
  const trimmed = value.trim()
  if (!trimmed) return ''
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1)
  }
  if (trimmed === 'true') return true
  if (trimmed === 'false') return false
  if (trimmed === 'null') return null
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed)
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    return trimmed.slice(1, -1).split(',').map((item) => item.trim()).filter(Boolean).map(scalar)
  }
  return trimmed
}

function parseFrontmatter(content: string): { frontmatter: Frontmatter; body: string } {
  if (!content.startsWith('---')) return { frontmatter: {}, body: content }
  const lines = content.split(/\r?\n/)
  if (lines[0]?.trim() !== '---') return { frontmatter: {}, body: content }
  const end = lines.findIndex((line, index) => index > 0 && line.trim() === '---')
  if (end < 0) return { frontmatter: {}, body: content }

  const frontmatter: Frontmatter = {}
  let activeArrayKey: string | null = null
  for (const line of lines.slice(1, end)) {
    const listItem = line.match(/^\s*-\s+(.+)$/)
    if (listItem && activeArrayKey) {
      const current = frontmatter[activeArrayKey]
      if (Array.isArray(current)) current.push(scalar(listItem[1] ?? ''))
      continue
    }
    const match = line.match(/^\s*([^:#]+):\s*(.*)$/)
    if (!match) continue
    const key = (match[1] ?? '').trim()
    const value = (match[2] ?? '').trim()
    if (!value) {
      frontmatter[key] = []
      activeArrayKey = key
    } else {
      frontmatter[key] = scalar(value)
      activeArrayKey = null
    }
  }
  return { frontmatter, body: lines.slice(end + 1).join('\n') }
}

function parseTableLine(line: string): string[] {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((cell) => cell.trim())
}

function parseTables(body: string): MarkdownTable[] {
  const lines = body.split(/\r?\n/)
  const tables: MarkdownTable[] = []
  for (let index = 0; index < lines.length - 1; index += 1) {
    if (!lines[index]?.includes('|') || !lines[index + 1]?.includes('|')) continue
    const headers = parseTableLine(lines[index] ?? '')
    const separator = parseTableLine(lines[index + 1] ?? '')
    if (headers.length === 0 || separator.length !== headers.length || !separator.every((cell) => /^:?-{3,}:?$/.test(cell))) continue
    const rows: Array<Record<string, string>> = []
    let rowIndex = index + 2
    while (rowIndex < lines.length && lines[rowIndex]?.includes('|')) {
      const values = parseTableLine(lines[rowIndex] ?? '')
      if (values.length !== headers.length) break
      rows.push(Object.fromEntries(headers.map((header, cellIndex) => [header, values[cellIndex] ?? ''])))
      rowIndex += 1
    }
    tables.push({ headers, rows })
    index = rowIndex - 1
  }
  return tables
}

function titleFrom(body: string, path: string): string {
  const heading = body.match(/^#\s+(.+)$/m)?.[1]?.trim()
  if (heading) return heading
  const filename = path.split(/[\\/]/).pop() ?? path
  return filename.replace(/\.md$/i, '')
}

export function parseNote(path: string, content: string): GrowthNote {
  const { frontmatter, body } = parseFrontmatter(content.replace(/^\uFEFF/, ''))
  const headings = Array.from(body.matchAll(/^#{1,6}\s+(.+)$/gm)).map((match) => match[1]?.trim() ?? '').filter(Boolean)
  const internalLinks = Array.from(body.matchAll(/\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|[^\]]+)?\]\]/g)).map((match) => match[1]?.trim() ?? '').filter(Boolean)
  const externalLinks = Array.from(content.matchAll(/https?:\/\/[^\s)\]>]+/g)).map((match) => match[0].replace(/[.,;!?]+$/, ''))
  const wordCount = body.trim() ? body.trim().split(/\s+/u).length : 0
  return {
    path,
    title: titleFrom(body, path),
    content,
    frontmatter,
    headings,
    tables: parseTables(body),
    internalLinks,
    externalLinks,
    wordCount,
  }
}

export function frontmatterString(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((item) => String(item)).join(', ')}]`
  if (value === null || value === undefined) return ''
  return String(value)
}

export function asMarkdownTable(rows: Array<Record<string, unknown>>): string {
  if (rows.length === 0) return '| 结果 |\n| --- |\n| 无数据 |'
  const headers = Array.from(new Set(rows.flatMap((row) => Object.keys(row))))
  const headerLine = `| ${headers.join(' | ')} |`
  const separator = `| ${headers.map(() => '---').join(' | ')} |`
  const data = rows.map((row) => `| ${headers.map((header) => String(row[header] ?? '')).join(' | ')} |`)
  return [headerLine, separator, ...data].join('\n')
}
