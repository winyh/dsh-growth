import { auditGrowthNote } from './context.js'
import { parseNote } from './markdown.js'
import type { FileSystemLike, GrowthConfig, GrowthNote, GrowthScanResult } from './types.js'

function isStale(updated: unknown): boolean {
  if (typeof updated !== 'string' || !updated.trim()) return true
  const date = new Date(updated)
  if (Number.isNaN(date.getTime())) return true
  return Date.now() - date.getTime() > 90 * 86_400_000
}

function isGrowthNote(note: GrowthNote): boolean {
  const type = String(note.frontmatter.type ?? '').toLowerCase()
  if (['growth-project', 'metric', 'experiment', 'campaign', 'growth-report', 'channel'].includes(type)) return true
  return /AARRR|North Star|增长|获客|留存|激活|MRR|CAC|LTV|实验|转化/i.test(note.content)
}

export async function readNote(fs: FileSystemLike, path: string, config: GrowthConfig, signal?: AbortSignal): Promise<GrowthNote> {
  const target = await fs.resolve(path, { signal })
  const info = await fs.stat(target, signal)
  if (!info || info.type !== 'file') throw new Error(`Markdown file not found: ${path}`)
  if ((info.size ?? 0) > config.maxFileBytes) throw new Error(`File exceeds maxFileBytes (${config.maxFileBytes})`)
  const content = await fs.readText(target, signal)
  if (content.length > config.maxTextChars) throw new Error(`File exceeds maxTextChars (${config.maxTextChars})`)
  return parseNote(path, content)
}

export async function scanGrowthVault(fs: FileSystemLike, root: string, config: GrowthConfig, signal?: AbortSignal): Promise<GrowthScanResult> {
  const errors: string[] = []
  const records: Array<{ note: GrowthNote; reasons: string[] }> = []
  let scannedFiles = 0
  let skippedFiles = 0

  async function visit(target: unknown, displayPath: string): Promise<void> {
    if (scannedFiles >= config.maxFiles) {
      skippedFiles += 1
      return
    }
    const entries = await fs.listDir(target, signal)
    for (const entry of entries) {
      if (scannedFiles >= config.maxFiles) {
        skippedFiles += 1
        continue
      }
      const childPath = `${displayPath.replace(/[\\/]$/, '')}/${entry.name}`
      if (entry.type === 'directory') {
        await visit(entry.target, childPath)
        continue
      }
      if (entry.type !== 'file' || !entry.name.toLowerCase().endsWith('.md')) continue
      scannedFiles += 1
      try {
        if ((entry.size ?? 0) > config.maxFileBytes) {
          skippedFiles += 1
          errors.push(`${childPath}: exceeds maxFileBytes`)
          continue
        }
        const content = await fs.readText(entry.target, signal)
        if (content.length > config.maxTextChars) {
          skippedFiles += 1
          errors.push(`${childPath}: exceeds maxTextChars`)
          continue
        }
        const note = parseNote(childPath, content)
        if (!isGrowthNote(note)) continue
        const reasons: string[] = []
        const type = String(note.frontmatter.type ?? '')
        const status = String(note.frontmatter.status ?? '')
        if (!note.frontmatter.type) reasons.push('missing type')
        if (!note.frontmatter.status) reasons.push('missing status')
        if (!note.frontmatter.updated || isStale(note.frontmatter.updated)) reasons.push('stale or missing updated date')
        if (!note.frontmatter.source && note.externalLinks.length === 0) reasons.push('missing source')
        if (!note.frontmatter.target && !/目标|target/i.test(note.content)) reasons.push('missing target')
        if (!note.frontmatter.owner && !/负责人|owner/i.test(note.content)) reasons.push('missing owner')
        records.push({ note, reasons: reasons.length > 0 ? reasons : ['healthy'] })
        void type
        void status
      } catch (error) {
        errors.push(`${childPath}: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
  }

  const rootTarget = await fs.resolve(root, { signal })
  await visit(rootTarget, root)
  const byType: Record<string, number> = {}
  const byStatus: Record<string, number> = {}
  let missingMetadata = 0
  let staleNotes = 0
  let missingSources = 0
  let missingTargets = 0
  for (const record of records) {
    const type = String(record.note.frontmatter.type ?? 'untyped')
    const status = String(record.note.frontmatter.status ?? 'unstated')
    byType[type] = (byType[type] ?? 0) + 1
    byStatus[status] = (byStatus[status] ?? 0) + 1
    if (!record.note.frontmatter.type || !record.note.frontmatter.status) missingMetadata += 1
    if (record.reasons.some((reason) => reason.includes('stale'))) staleNotes += 1
    if (record.reasons.some((reason) => reason.includes('source'))) missingSources += 1
    if (record.reasons.some((reason) => reason.includes('target'))) missingTargets += 1
  }
  return {
    root,
    generatedAt: new Date().toISOString(),
    scannedFiles,
    skippedFiles,
    errors,
    summary: {
      growthNotes: records.length,
      missingMetadata,
      staleNotes,
      missingSources,
      missingTargets,
      byType,
      byStatus,
    },
    priorityFiles: records
      .toSorted((left, right) => right.reasons.length - left.reasons.length)
      .slice(0, 20)
      .map((record) => ({
        path: record.note.path,
        title: record.note.title,
        type: String(record.note.frontmatter.type ?? 'untyped'),
        status: String(record.note.frontmatter.status ?? 'unstated'),
        reasons: record.reasons,
      })),
  }
}

export function summarizeAudit(note: GrowthNote): string[] {
  return auditGrowthNote(note).topActions
}
