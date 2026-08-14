import { dateValue, numberValue, readDataset, stringValue } from './data.js'
import type { FileSystemLike, GrowthConfig, GrowthDoctorResult, DatasetProfile, FieldCandidate, Row } from './types.js'

type FieldRole = 'userField' | 'eventField' | 'timeField' | 'channelField' | 'segmentField' | 'periodField' | 'typeField' | 'amountField' | 'customerField' | 'spendField' | 'currencyField'

const aliases: Record<FieldRole, string[]> = {
  userField: ['user_id', 'userid', 'user', 'visitor_id', 'member_id', 'account_id'],
  eventField: ['event', 'event_name', 'eventname', 'action', 'activity'],
  timeField: ['timestamp', 'occurred_at', 'occurredat', 'datetime', 'date', 'time', 'created_at', 'createdat'],
  channelField: ['channel', 'acquisition_channel', 'source', 'utm_source', 'campaign'],
  segmentField: ['segment', 'plan', 'tier', 'country', 'region', 'cohort'],
  periodField: ['period', 'month', 'week', 'billing_period'],
  typeField: ['movement_type', 'movement', 'type', 'kind', 'change_type'],
  amountField: ['amount', 'mrr', 'revenue', 'value', 'arr', 'delta_mrr'],
  customerField: ['customer_id', 'customerid', 'account_id', 'user_id'],
  spendField: ['spend', 'cost', 'acquisition_spend', 'marketing_spend', 'ad_spend'],
  currencyField: ['currency', 'currency_code', 'currencycode'],
}

const supportedExtensions = new Set(['.csv', '.json', '.jsonl', '.ndjson'])
const ignoredDirectories = new Set(['.git', 'node_modules', 'lib', '.dsh-growth'])

function normalized(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')
}

function nonEmpty(value: unknown): boolean {
  return value !== undefined && value !== null && value !== ''
}

function percentage(value: number, total: number): number {
  return total === 0 ? 0 : Math.round((value / total) * 1000) / 10
}

function valuesFor(rows: Row[], field: string | null): string[] {
  if (!field) return []
  const values = new Set<string>()
  for (const row of rows) {
    const value = stringValue(row, field)
    if (value) values.add(value)
    if (values.size >= 50) break
  }
  return [...values].toSorted((left, right) => left.localeCompare(right)).slice(0, 50)
}

function fieldScore(field: string, role: FieldRole, rows: Row[]): FieldCandidate {
  const normalizedField = normalized(field)
  const roleAliases = aliases[role]
  const exactIndex = roleAliases.indexOf(normalizedField)
  const contains = roleAliases.some((alias) => normalizedField.includes(alias) || alias.includes(normalizedField))
  const coverageCount = rows.filter((row) => nonEmpty(row[field])).length
  const coverage = percentage(coverageCount, rows.length)
  const score = (exactIndex >= 0 ? 100 : contains ? 60 : 0) + Math.round(coverage / 5)
  const reason = exactIndex >= 0
    ? `field name matches ${role}`
    : contains
      ? `field name is similar to a ${role} alias`
      : `coverage ${coverage}%`
  return { field, score, coverage, nonEmpty: coverageCount, reason }
}

function candidates(columns: string[], role: FieldRole, rows: Row[]): FieldCandidate[] {
  return columns
    .map((field) => fieldScore(field, role, rows))
    .filter((candidate) => candidate.score > 0)
    .toSorted((left, right) => right.score - left.score || right.coverage - left.coverage)
    .slice(0, 5)
}

function selectField(role: FieldRole, fields: FieldCandidate[], hint: string | undefined, columns: string[]): string | null {
  if (hint?.trim()) {
    if (!columns.includes(hint.trim())) throw new Error(`${role} hint '${hint}' is not a column in the dataset`)
    return hint.trim()
  }
  return fields[0]?.field ?? null
}

function rowFingerprint(row: Row): string {
  try {
    return JSON.stringify(Object.entries(row).toSorted(([left], [right]) => left.localeCompare(right)))
  } catch {
    return Object.keys(row).toSorted().join('|')
  }
}

function statusFor(rowCount: number, selectedFields: Record<string, string | null>, invalidDateRows: number, invalidNumberRows: number): 'pass' | 'warning' | 'error' {
  if (rowCount === 0) return 'error'
  const recognized = Object.values(selectedFields).filter(Boolean).length
  if (recognized === 0) return 'error'
  if (invalidDateRows > rowCount * 0.2 || invalidNumberRows > rowCount * 0.2) return 'warning'
  if (!selectedFields.userField && !selectedFields.customerField) return 'warning'
  return 'pass'
}

export function profileDataset(source: string, rows: Row[], hints: Partial<Record<FieldRole, string>> = {}): DatasetProfile {
  const columns = [...new Set(rows.flatMap((row) => Object.keys(row)))].toSorted()
  const fieldCandidates = Object.fromEntries(Object.keys(aliases).map((role) => [role, candidates(columns, role as FieldRole, rows)])) as Record<FieldRole, FieldCandidate[]>
  const selectedFields = Object.fromEntries(Object.keys(aliases).map((role) => {
    const typedRole = role as FieldRole
    return [role, selectField(typedRole, fieldCandidates[typedRole] ?? [], hints[typedRole], columns)]
  })) as Record<FieldRole, string | null>

  const timeField = selectedFields.timeField
  const amountFields = [selectedFields.amountField, selectedFields.spendField].filter((field): field is string => Boolean(field))
  let missingRows = 0
  let invalidDateRows = 0
  let invalidNumberRows = 0
  let minDate: Date | undefined
  let maxDate: Date | undefined
  const fingerprints = new Set<string>()
  let duplicateRows = 0
  for (const row of rows) {
    if (Object.values(row).every((value) => !nonEmpty(value))) missingRows += 1
    const fingerprint = rowFingerprint(row)
    if (fingerprints.has(fingerprint)) duplicateRows += 1
    fingerprints.add(fingerprint)
    if (timeField && nonEmpty(row[timeField])) {
      const date = dateValue(row, timeField)
      if (!date) invalidDateRows += 1
      else {
        if (!minDate || date < minDate) minDate = date
        if (!maxDate || date > maxDate) maxDate = date
      }
    }
    for (const field of amountFields) {
      if (nonEmpty(row[field]) && numberValue(row, field) === undefined) invalidNumberRows += 1
    }
  }

  const warnings: string[] = []
  if (!selectedFields.userField && !selectedFields.customerField) warnings.push('No user/customer identifier candidate was found; user-level conversion and retention cannot be trusted')
  if (!selectedFields.eventField && !selectedFields.typeField) warnings.push('No event or movement type candidate was found; event funnel and MRR bridge selection may be unavailable')
  if (!selectedFields.timeField) warnings.push('No timestamp/date candidate was found; time-window analysis will be unavailable')
  if (invalidDateRows > 0) warnings.push(`${invalidDateRows} rows contain an invalid date in '${timeField}'`)
  if (invalidNumberRows > 0) warnings.push(`${invalidNumberRows} numeric cells are not parseable in amount/spend fields`)
  if (duplicateRows > 0) warnings.push(`${duplicateRows} duplicate rows detected; verify whether they are repeated events or ingestion duplicates`)
  if (missingRows > 0) warnings.push(`${missingRows} completely empty rows detected`)

  const recommendations: string[] = []
  if (selectedFields.userField && selectedFields.eventField && selectedFields.timeField) recommendations.push('Event dataset is ready for funnel and cohort analysis after checking event names')
  else if (selectedFields.periodField && selectedFields.typeField && selectedFields.amountField) recommendations.push('Movement dataset is ready for an MRR bridge after confirming amount sign semantics')
  if (!selectedFields.userField && !selectedFields.customerField) recommendations.push('Add a stable pseudonymous user_id or customer_id; do not use email as a default identifier')
  if (!selectedFields.timeField) recommendations.push('Add an ISO-8601 timestamp or explicit period field before comparing time windows')
  if (invalidDateRows > 0 || invalidNumberRows > 0) recommendations.push('Fix invalid dates/numbers or provide a mapping before using the result for decisions')

  return {
    source,
    rowCount: rows.length,
    columnCount: columns.length,
    columns,
    fieldCandidates,
    selectedFields,
    distinctValues: {
      events: valuesFor(rows, selectedFields.eventField),
      movementTypes: valuesFor(rows, selectedFields.typeField),
      currencies: valuesFor(rows, selectedFields.currencyField),
    },
    dateRange: minDate && maxDate ? { min: minDate.toISOString(), max: maxDate.toISOString() } : null,
    quality: {
      status: statusFor(rows.length, selectedFields, invalidDateRows, invalidNumberRows),
      duplicateRows,
      missingRows,
      invalidDateRows,
      invalidNumberRows,
      warnings,
    },
    recommendations,
  }
}

function extensionOf(path: string): string {
  const match = /\.[^./\\]+$/.exec(path.toLowerCase())
  return match?.[0] ?? ''
}

export async function doctorRoot(fs: FileSystemLike, root: string, config: GrowthConfig, signal?: AbortSignal): Promise<GrowthDoctorResult> {
  const checks: GrowthDoctorResult['checks'] = []
  const datasets: GrowthDoctorResult['datasets'] = []
  const byExtension: Record<string, number> = {}
  let scanned = 0
  let supported = 0
  let skipped = 0
  const rootTarget = await fs.resolve(root, { signal })
  const rootInfo = await fs.stat(rootTarget, signal)
  if (!rootInfo || rootInfo.type !== 'directory') throw new Error(`Configured root is not a directory: ${root}`)
  checks.push({ name: 'root', status: 'pass', message: `Root is readable: ${root}` })

  async function visit(target: unknown, displayPath: string): Promise<void> {
    if (scanned >= config.maxFiles) {
      skipped += 1
      return
    }
    let entries
    try {
      entries = await fs.listDir(target, signal)
    } catch (error) {
      checks.push({ name: `directory:${displayPath}`, status: 'warning', message: error instanceof Error ? error.message : String(error) })
      return
    }
    for (const entry of entries) {
      if (scanned >= config.maxFiles) {
        skipped += 1
        continue
      }
      if (entry.type === 'directory') {
        if (!ignoredDirectories.has(entry.name.toLowerCase())) await visit(entry.target, `${displayPath.replace(/[\\/]$/, '')}/${entry.name}`)
        continue
      }
      if (entry.type !== 'file') continue
      scanned += 1
      const extension = extensionOf(entry.name)
      byExtension[extension || '(none)'] = (byExtension[extension || '(none)'] ?? 0) + 1
      if (!supportedExtensions.has(extension)) continue
      supported += 1
      const path = `${displayPath.replace(/[\\/]$/, '')}/${entry.name}`
      try {
        const dataset = await readDataset(fs, config, path, signal)
        const profile = profileDataset(path, dataset.rows)
        datasets.push({ path, extension, rowCount: profile.rowCount, status: profile.quality.status, warnings: [...dataset.warnings, ...profile.quality.warnings] })
      } catch (error) {
        datasets.push({ path, extension, rowCount: null, status: 'error', warnings: [error instanceof Error ? error.message : String(error)] })
      }
    }
  }

  await visit(rootTarget, root)
  if (supported === 0) checks.push({ name: 'datasets', status: 'warning', message: 'No CSV, JSON or JSONL datasets found under the configured root' })
  else checks.push({ name: 'datasets', status: datasets.some((item) => item.status === 'error') ? 'warning' : 'pass', message: `${supported} supported dataset file(s) discovered` })
  if (skipped > 0) checks.push({ name: 'limits', status: 'warning', message: `${skipped} file(s) were skipped because maxFiles=${config.maxFiles}` })
  const errors = datasets.filter((item) => item.status === 'error').length
  const warnings = datasets.reduce((sum, item) => sum + item.warnings.length, 0) + checks.filter((item) => item.status === 'warning').length
  const status = errors > 0 ? 'error' : warnings > 0 ? 'warning' : 'pass'
  const nextActions: string[] = []
  if (errors > 0) nextActions.push('Fix unreadable or invalid dataset files before using automated review')
  if (datasets.some((item) => item.warnings.length > 0)) nextActions.push('Open the flagged dataset with growth_profile_dataset and confirm field mappings')
  if (supported === 0) nextActions.push('Add an event or MRR movement export under the configured root')
  if (nextActions.length === 0) nextActions.push('Run growth_review with a business goal and the most relevant event/MRR dataset')
  return {
    generatedAt: new Date().toISOString(),
    root,
    checks,
    files: { scanned, supported, skipped, byExtension },
    datasets,
    summary: { status, errors, warnings },
    nextActions,
  }
}

