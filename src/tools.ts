import type { Context } from '@deepseek-ai/cordis'
import { defineTool, type JsonValue } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-fs'
import { auditGrowthNote } from './context.js'
import { readDataset } from './data.js'
import { diagnoseGrowth } from './diagnostics.js'
import { analyzeEconomics } from './economics.js'
import { createExperiment, calculatePriority, parseGuardrails } from './experiments.js'
import { analyzeFunnel, parseStages } from './funnel.js'
import { analyzeCohorts } from './cohort.js'
import { parseList } from './metrics.js'
import { parseNote } from './markdown.js'
import { renderReport } from './reports.js'
import { resultEnvelope, renderResult, resultSchema } from './output.js'
import { buildReview, inferStages, selectReviewSources } from './review.js'
import { doctorRoot, profileDataset } from './quality.js'
import { buildGrowthOnboarding, collectOnboardingNotes, collectOnboardingProfiles } from './onboarding.js'
import { buildMetricContractReview, consumeGrowthHandoff } from './contracts.js'
import type { GrowthDataServiceApi } from './service.js'
import { readNote, scanGrowthVault } from './vault.js'
import type { ResultLineage } from './output.js'
import type { CohortAnalysis, DatasetProfile, EconomicsAnalysis, FileSystemLike, FunnelAnalysis, GrowthAuditResult, GrowthConfig, GrowthReviewResult, PriorityItem, PriorityMethod, ReportType, Row } from './types.js'

function growthOutput(maxChars: number) {
  return { schema: resultSchema, render: (_args: unknown, value: unknown) => renderResult(value, maxChars) }
}

function wrapResult(value: unknown, options: { lineage?: ResultLineage[]; assumptions?: string[]; nextActions?: string[] } = {}) {
  const warnings = typeof value === 'object' && value !== null && 'warnings' in value && Array.isArray(value.warnings)
    ? value.warnings.filter((warning): warning is string => typeof warning === 'string')
    : []
  return resultEnvelope({ data: value as JsonValue, warnings, assumptions: options.assumptions, lineage: options.lineage, nextActions: options.nextActions })
}

function fsFrom(ctx: Context): FileSystemLike {
  return (ctx as unknown as { fs: FileSystemLike }).fs
}

function growthDataFrom(ctx: Context): GrowthDataServiceApi | undefined {
  return (ctx as unknown as { 'growth-data'?: GrowthDataServiceApi })['growth-data']
}

async function ensureInsideRoot(fs: FileSystemLike, config: GrowthConfig, targetPath: string, signal?: AbortSignal): Promise<void> {
  const root = await fs.resolve(config.defaultRoot, { signal })
  const target = await fs.resolve(targetPath, { signal })
  if (!fs.contains(root, target)) throw new Error(`Path is outside configured defaultRoot: ${targetPath}`)
}

function priorityItems(value: string): PriorityItem[] {
  const parsed: unknown = JSON.parse(value)
  if (!Array.isArray(parsed)) throw new Error('items must be a JSON array')
  return parsed.map((item, index) => {
    if (typeof item !== 'object' || item === null) throw new Error(`items[${index}] must be an object`)
    const record = item as Record<string, unknown>
    const method = validMethod(record.method === undefined ? undefined : String(record.method))
    const priority = calculatePriority({
      method,
      reach: typeof record.reach === 'number' ? record.reach : undefined,
      impact: typeof record.impact === 'number' ? record.impact : undefined,
      confidence: typeof record.confidence === 'number' ? record.confidence : undefined,
      effort: typeof record.effort === 'number' ? record.effort : undefined,
      ease: typeof record.ease === 'number' ? record.ease : undefined,
    })
    return {
      ...priority,
      title: String(record.title ?? `Opportunity ${index + 1}`),
      evidence: record.evidence ? String(record.evidence) : undefined,
      targetMetric: record.targetMetric ? String(record.targetMetric) : undefined,
    }
  })
}

function validInterval(value: string | undefined): 'day' | 'week' | 'month' {
  if (value === undefined || value === '') return 'week'
  if (value === 'day' || value === 'week' || value === 'month') return value
  throw new Error(`interval must be one of: day, week, month; received '${value}'`)
}

function validStage(value: string | undefined): 'acquisition' | 'activation' | 'retention' | 'referral' | 'revenue' {
  if (value === undefined || value === '') return 'activation'
  if (value === 'acquisition' || value === 'activation' || value === 'retention' || value === 'referral' || value === 'revenue') return value
  throw new Error(`stage must be one of: acquisition, activation, retention, referral, revenue; received '${value}'`)
}

function validReportType(value: string | undefined): ReportType {
  if (value === undefined || value === '') return 'wbr'
  if (value === 'wbr' || value === 'mbr' || value === 'qbr' || value === 'experiment-review') return value
  throw new Error(`reportType must be one of: wbr, mbr, qbr, experiment-review; received '${value}'`)
}

function validMethod(value: string | undefined): PriorityMethod {
  if (value === undefined || value === '') return 'rice'
  if (value === 'rice' || value === 'ice') return value
  throw new Error(`method must be one of: rice, ice; received '${value}'`)
}

function validSequenceMode(value: string | undefined): 'any-event' | 'ordered' {
  if (value === undefined || value === '') return 'any-event'
  if (value === 'any-event' || value === 'ordered') return value
  throw new Error(`sequenceMode must be one of: any-event, ordered; received '${value}'`)
}

function validAttribution(value: string | undefined): 'first-touch' | 'last-touch' | 'entry-touch' {
  if (value === undefined || value === '') return 'entry-touch'
  if (value === 'first-touch' || value === 'last-touch' || value === 'entry-touch') return value
  throw new Error(`attribution must be one of: first-touch, last-touch, entry-touch; received '${value}'`)
}

function validWindow(value: number | undefined): number | undefined {
  if (value === undefined) return undefined
  if (!Number.isInteger(value) || value <= 0 || value > 3650) throw new Error(`conversionWindowDays must be an integer from 1 to 3650; received '${value}'`)
  return value
}

function validAmountMode(value: string | undefined): 'absolute' | 'signed' {
  if (value === undefined || value === '') return 'absolute'
  if (value === 'absolute' || value === 'signed') return value
  throw new Error(`amountMode must be one of: absolute, signed; received '${value}'`)
}

function validMovementSource(value: string | undefined): 'movement' | 'snapshot' {
  if (value === undefined || value === '') return 'movement'
  if (value === 'movement' || value === 'snapshot') return value
  throw new Error(`movementSource must be one of: movement, snapshot; received '${value}'`)
}

function validGrossMargin(value: number | undefined): number {
  if (value === undefined) return 1
  if (!Number.isFinite(value) || value <= 0 || value > 1) throw new Error(`grossMargin must be greater than 0 and no greater than 1; received '${value}'`)
  return value
}

function validMaxPeriods(value: number | undefined): number {
  if (value === undefined) return 12
  if (!Number.isInteger(value) || value < 1 || value > 52) throw new Error(`maxPeriods must be an integer from 1 to 52; received '${value}'`)
  return value
}

function reportInputFromReview(value: string): {
  summary: string
  metrics: Array<{ name: string; current: string; previous?: string; delta?: string; source?: string }>
  findings: string[]
  experiments: string[]
  nextActions: string[]
  caveats: string[]
  sources: string[]
} {
  const parsed: unknown = JSON.parse(value)
  const envelope = typeof parsed === 'object' && parsed !== null && 'data' in parsed ? parsed.data : parsed
  if (typeof envelope !== 'object' || envelope === null || !('goal' in envelope) || !('profiles' in envelope)) throw new Error('reviewJson must be a growth_review result or its data object')
  const review = envelope as GrowthReviewResult
  const metrics: Array<{ name: string; current: string; previous?: string; delta?: string; source?: string }> = []
  const sources = review.profiles.map((profile) => profile.source)
  const source = sources[0]
  const funnel = review.analyses.funnel
  if (funnel) funnel.stages.forEach((stage, index) => metrics.push({ name: `${stage.name} users`, current: String(stage.users), previous: index > 0 ? String(funnel.stages[index - 1]?.users ?? '-') : undefined, delta: stage.conversionFromPrevious === null ? undefined : `${stage.conversionFromPrevious}%`, source: funnel.source }))
  const cohort = review.analyses.cohort
  if (cohort) {
    const cell = cohort.cohorts[0]?.cells.find((item) => item.period === 1)
    if (cell) metrics.push({ name: 'retention period 1', current: `${cell.retentionRate ?? '-'}%`, source: cohort.source })
  }
  const economics = review.analyses.economics
  const latest = economics?.periods.at(-1)
  if (economics && latest) {
    metrics.push({ name: 'ending MRR', current: String(latest.endingMrr ?? '-'), source: economics.source })
    metrics.push({ name: 'NRR', current: `${latest.nrr ?? '-'}%`, source: economics.source })
    metrics.push({ name: 'CAC', current: String(latest.cac ?? '-'), source: economics.source })
  }
  return {
    summary: review.bottlenecks[0] ? `${review.goal}; ${review.bottlenecks[0]}` : review.goal,
    metrics,
    findings: review.bottlenecks,
    experiments: review.hypotheses,
    nextActions: review.nextActions,
    caveats: [...review.warnings, ...review.profiles.flatMap((profile) => profile.quality.warnings)],
    sources: source ? [...new Set([source, ...sources])] : [...new Set(sources)],
  }
}

function replacementDiff(before: string, after: string): { beforeLines: number; afterLines: number; changedLines: number; preview: string[] } {
  const beforeLines = before.split(/\r?\n/)
  const afterLines = after.split(/\r?\n/)
  const preview: string[] = []
  let changedLines = 0
  const length = Math.max(beforeLines.length, afterLines.length)
  for (let index = 0; index < length; index += 1) {
    const left = beforeLines[index]
    const right = afterLines[index]
    if (left === right) continue
    changedLines += 1
    if (preview.length < 20) {
      if (left !== undefined) preview.push(`- ${left}`)
      if (right !== undefined) preview.push(`+ ${right}`)
    }
  }
  return { beforeLines: beforeLines.length, afterLines: afterLines.length, changedLines, preview }
}

function emitAnalysisStarted(ctx: Context, kind: string, sources: string[], goal?: string): void {
  ctx.emit('growth/analysis-started', { kind, sources, ...(goal ? { goal } : {}) })
}

function emitAnalysisCompleted(ctx: Context, kind: string, sources: string[], warningCount: number): void {
  ctx.emit('growth/analysis-completed', { kind, sources, warningCount })
}

interface DiscoveredReviewDataset {
  path: string
  rows: Row[]
  warnings: string[]
  profile: DatasetProfile
}

async function discoverReviewDatasets(
  fs: FileSystemLike,
  config: GrowthConfig,
  root: string,
  signal: AbortSignal | undefined,
  growthData?: GrowthDataServiceApi,
): Promise<{ datasets: DiscoveredReviewDataset[]; warnings: string[] }> {
  const health = await (growthData?.doctor(root, signal) ?? doctorRoot(fs, root, config, signal))
  const datasets: DiscoveredReviewDataset[] = []
  const warnings = health.checks.filter((check) => check.status === 'warning').map((check) => `Auto-discovery: ${check.message}`)
  for (const summary of health.datasets) {
    if (summary.status === 'error') continue
    try {
      const dataset = await (growthData?.readDataset(summary.path, signal) ?? readDataset(fs, config, summary.path, signal))
      const profile = growthData?.profileDataset(summary.path, dataset.rows)
        ?? profileDataset(summary.path, dataset.rows)
      profile.quality.warnings = [...new Set([...profile.quality.warnings, ...dataset.warnings, ...summary.warnings])]
      datasets.push({ path: summary.path, rows: dataset.rows, warnings: dataset.warnings, profile })
    } catch (error) {
      warnings.push(`Auto-discovery skipped '${summary.path}': ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  return { datasets, warnings }
}

export function registerGrowthTools(ctx: Context, config: GrowthConfig): void {
  const fs = fsFrom(ctx)
  const growthData = growthDataFrom(ctx)

  ctx.tools.register(defineTool({
    name: 'growth_handoff_consume',
    description: 'Consume and validate a dsh-product growth-handoff before measurement work. It requires product outcome evidence, a primary metric, guardrails and open questions to remain visible.',
    parameters: {
      handoffJson: { type: 'string', required: true, description: 'JSON returned by product_growth_handoff, including its result envelope or data object.' },
    },
    output: growthOutput(config.maxResultChars),
    async execute(args) {
      let parsed: unknown
      try { parsed = JSON.parse(args.handoffJson) as unknown } catch (error) { throw new Error(`handoffJson must be valid JSON: ${error instanceof Error ? error.message : String(error)}`) }
      const data = typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) && 'data' in parsed ? (parsed as { data: unknown }).data : parsed
      if (typeof data !== 'object' || data === null || Array.isArray(data)) throw new Error('handoffJson must contain an object.')
      const result = consumeGrowthHandoff(data as Record<string, unknown>)
      return wrapResult(result, { nextActions: result.nextActions })
    },
  }))

  ctx.tools.register(defineTool({
    name: 'growth_metric_contract',
    description: 'Validate a shared event/metric definition set with explicit event, observation window, timezone and optional currency. It does not calculate the metric.',
    parameters: {
      metricsJson: { type: 'string', required: true, description: 'JSON array of metric definitions.' },
    },
    output: growthOutput(config.maxResultChars),
    async execute(args) {
      let parsed: unknown
      try { parsed = JSON.parse(args.metricsJson) as unknown } catch (error) { throw new Error(`metricsJson must be valid JSON: ${error instanceof Error ? error.message : String(error)}`) }
      const metrics = typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) && 'data' in parsed ? (parsed as { data: unknown }).data : parsed
      if (!Array.isArray(metrics)) throw new Error('metricsJson must contain an array.')
      const result = buildMetricContractReview({ metrics, timezone: config.defaultTimezone, currency: config.defaultCurrency })
      return wrapResult(result, { nextActions: result.nextActions })
    },
  }))

  ctx.tools.register(defineTool({
    name: 'growth_audit_note',
    description: 'Audit one Markdown growth note for JTBD, PMF, North Star, AARRR, metrics, evidence and experiment readiness. Reads only.',
    parameters: {
      path: { type: 'string', required: true, description: 'Absolute or workspace-relative Markdown path.' },
    },
    output: growthOutput(config.maxResultChars),
    async execute(args, exec) {
      await ensureInsideRoot(fs, config, args.path, exec.signal)
      const note = await readNote(fs, args.path, config, exec.signal)
      const audit = auditGrowthNote(note)
      return wrapResult(audit, { lineage: [{ source: args.path }] })
    },
  }))

  ctx.tools.register(defineTool({
    name: 'growth_audit_vault',
    description: 'Scan a local Markdown knowledge base for growth-project, metric, experiment, channel and report quality gaps. Reads only.',
    parameters: {
      root: { type: 'string', description: 'Optional directory under defaultRoot.' },
    },
    output: growthOutput(config.maxResultChars),
    async execute(args, exec) {
      const root = args.root?.trim() || config.defaultRoot
      await ensureInsideRoot(fs, config, root, exec.signal)
      const scan = await scanGrowthVault(fs, root, config, exec.signal)
      return wrapResult(scan, { lineage: [{ source: root }] })
    },
  }))

  ctx.tools.register(defineTool({
    name: 'growth_doctor',
    description: 'Run a read-only health check on the configured local growth workspace: discover supported datasets, inspect limits, and summarize data quality issues without returning raw rows.',
    parameters: {
      root: { type: 'string', description: 'Optional directory under defaultRoot.' },
      includeDatasets: { type: 'boolean', description: 'Whether to include per-file summaries; defaults to true.' },
    },
    output: growthOutput(config.maxResultChars),
    async execute(args, exec) {
      const root = args.root?.trim() || config.defaultRoot
      await ensureInsideRoot(fs, config, root, exec.signal)
      emitAnalysisStarted(ctx, 'doctor', [root])
      const result = await (growthData?.doctor(root, exec.signal) ?? doctorRoot(fs, root, config, exec.signal))
      if (args.includeDatasets === false) result.datasets = []
      emitAnalysisCompleted(ctx, 'doctor', [root], result.summary.warnings + result.summary.errors)
      return wrapResult(result, { lineage: [{ source: root }], nextActions: result.nextActions })
    },
  }))

  ctx.tools.register(defineTool({
    name: 'growth_onboarding',
    description: 'Run a read-only growth readiness check across local strategy notes and datasets. Reports what is ready, partial, missing or not supported, including classic method coverage and the top two gaps to fix next.',
    parameters: {
      root: { type: 'string', description: 'Optional project directory under defaultRoot; defaults to defaultRoot.' },
      notePath: { type: 'string', description: 'Optional Markdown strategy note to audit instead of scanning all growth notes under root.' },
    },
    output: growthOutput(config.maxResultChars),
    async execute(args, exec) {
      const root = args.root?.trim() || config.defaultRoot
      await ensureInsideRoot(fs, config, root, exec.signal)
      if (args.notePath?.trim()) {
        await ensureInsideRoot(fs, config, args.notePath, exec.signal)
        const rootTarget = await fs.resolve(root, { signal: exec.signal })
        const noteTarget = await fs.resolve(args.notePath, { signal: exec.signal })
        if (!fs.contains(rootTarget, noteTarget)) throw new Error(`notePath must be inside root: ${args.notePath}`)
      }
      emitAnalysisStarted(ctx, 'onboarding', [root, ...(args.notePath?.trim() ? [args.notePath.trim()] : [])])
      const notes = await collectOnboardingNotes(fs, root, config, exec.signal, args.notePath?.trim() || undefined)
      const datasets = await collectOnboardingProfiles(fs, config, root, exec.signal, growthData)
      const result = buildGrowthOnboarding({
        root,
        notes: notes.notes,
        profiles: datasets.profiles,
        datasetWarnings: datasets.warnings,
        scanErrors: notes.errors,
        skippedFiles: notes.skippedFiles,
      })
      emitAnalysisCompleted(ctx, 'onboarding', [root], result.warnings.length)
      result.warnings.forEach((message) => ctx.emit('growth/warning', { kind: 'onboarding', source: root, message }))
      return wrapResult(result, {
        lineage: [{ source: root }, ...(args.notePath?.trim() ? [{ source: args.notePath.trim() }] : [])],
        assumptions: ['Readiness is based on detected local evidence; an undetected method is not proof that the team has never used it.', 'Not-supported methods require an external research, experiment or execution system.'],
        nextActions: result.topActions,
      })
    },
  }))

  ctx.tools.register(defineTool({
    name: 'growth_profile_dataset',
    description: 'Profile one local CSV, JSON or JSONL dataset. Infers field mappings, coverage, date range and quality warnings while omitting raw user-level samples.',
    parameters: {
      sourcePath: { type: 'string', required: true, description: 'CSV, JSON or JSONL dataset path.' },
      userField: { type: 'string', description: 'Optional explicit user/customer identifier field.' },
      eventField: { type: 'string', description: 'Optional explicit event field.' },
      timeField: { type: 'string', description: 'Optional explicit timestamp/date field.' },
      channelField: { type: 'string', description: 'Optional explicit acquisition channel field.' },
      segmentField: { type: 'string', description: 'Optional explicit segment field.' },
      periodField: { type: 'string', description: 'Optional explicit MRR period field.' },
      typeField: { type: 'string', description: 'Optional explicit MRR movement type field.' },
      amountField: { type: 'string', description: 'Optional explicit amount/MRR field.' },
      customerField: { type: 'string', description: 'Optional explicit customer identifier field.' },
      spendField: { type: 'string', description: 'Optional explicit acquisition spend field.' },
      currencyField: { type: 'string', description: 'Optional explicit currency field.' },
    },
    output: growthOutput(config.maxResultChars),
    async execute(args, exec) {
      await ensureInsideRoot(fs, config, args.sourcePath, exec.signal)
      emitAnalysisStarted(ctx, 'profile', [args.sourcePath])
      const dataset = await (growthData?.readDataset(args.sourcePath, exec.signal) ?? readDataset(fs, config, args.sourcePath, exec.signal))
      const profile = (growthData?.profileDataset(args.sourcePath, dataset.rows, {
        userField: args.userField,
        eventField: args.eventField,
        timeField: args.timeField,
        channelField: args.channelField,
        segmentField: args.segmentField,
        periodField: args.periodField,
        typeField: args.typeField,
        amountField: args.amountField,
        customerField: args.customerField,
        spendField: args.spendField,
        currencyField: args.currencyField,
      }) ?? profileDataset(args.sourcePath, dataset.rows, {
        userField: args.userField,
        eventField: args.eventField,
        timeField: args.timeField,
        channelField: args.channelField,
        segmentField: args.segmentField,
        periodField: args.periodField,
        typeField: args.typeField,
        amountField: args.amountField,
        customerField: args.customerField,
        spendField: args.spendField,
        currencyField: args.currencyField,
      }))
      profile.quality.warnings.push(...dataset.warnings)
      emitAnalysisCompleted(ctx, 'profile', [args.sourcePath], profile.quality.warnings.length)
      profile.quality.warnings.forEach((message) => ctx.emit('growth/warning', { kind: 'profile', source: args.sourcePath, message }))
      return wrapResult(profile, {
        lineage: [{ source: args.sourcePath, fields: profile.columns }],
        nextActions: profile.recommendations,
      })
    },
  }))

  ctx.tools.register(defineTool({
    name: 'growth_review',
    description: 'Run a goal-oriented local growth review: profile data, choose usable AARRR/cohort/MRR analyses, identify bottlenecks and propose evidence-aware next actions. Paths are optional; when omitted, the configured root is scanned and selected sources are reported.',
    parameters: {
      goal: { type: 'string', required: true, description: 'Business goal or decision to support, such as improve activation or decide whether to scale a channel.' },
      root: { type: 'string', description: 'Optional directory under defaultRoot to scan when eventPath and economicsPath are omitted.' },
      eventPath: { type: 'string', description: 'Optional event dataset path for funnel/cohort analysis.' },
      economicsPath: { type: 'string', description: 'Optional MRR movement/cost dataset path for unit economics.' },
      notePath: { type: 'string', description: 'Optional Markdown growth note path for context and evidence audit.' },
      userField: { type: 'string', description: 'Optional event user identifier field.' },
      eventField: { type: 'string', description: 'Optional event name field.' },
      timeField: { type: 'string', description: 'Optional event timestamp/date field.' },
      periodField: { type: 'string', description: 'Optional MRR period field.' },
      typeField: { type: 'string', description: 'Optional MRR movement type field.' },
      amountField: { type: 'string', description: 'Optional MRR amount field.' },
      grossMargin: { type: 'number', description: 'Optional gross margin ratio for economics.' },
      amountMode: { type: 'string', description: 'absolute or signed MRR input semantics.' },
      movementSource: { type: 'string', description: 'movement or snapshot economics source.' },
    },
    output: growthOutput(config.maxResultChars),
    async execute(args, exec) {
      let eventPath = args.eventPath?.trim() || undefined
      let economicsPath = args.economicsPath?.trim() || undefined
      const notePath = args.notePath?.trim() || undefined
      const profiles: DatasetProfile[] = []
      const lineage: ResultLineage[] = []
      const reviewWarnings: string[] = []
      const reviewAssumptions: string[] = []
      const discoveredByPath = new Map<string, DiscoveredReviewDataset>()
      if (!eventPath && !economicsPath && !notePath) {
        const root = args.root?.trim() || config.defaultRoot
        await ensureInsideRoot(fs, config, root, exec.signal)
        const discovered = await discoverReviewDatasets(fs, config, root, exec.signal, growthData)
        const selection = selectReviewSources(discovered.datasets.map((item) => item.profile))
        discovered.datasets.forEach((item) => discoveredByPath.set(item.path, item))
        eventPath = selection.eventPath
        economicsPath = selection.economicsPath
        reviewWarnings.push(...discovered.warnings)
        if (eventPath) {
          reviewAssumptions.push(`eventPath was omitted; auto-selected ${eventPath} from ${root} because it contains a user field, event field, timestamp and at least two recognizable stages`)
          if (selection.eventCandidates.length > 1) reviewWarnings.push(`Auto-discovery found multiple event datasets; selected '${eventPath}'. Other candidates: ${selection.eventCandidates.slice(1).join(', ')}`)
        } else {
          reviewWarnings.push(`Auto-discovery found no dataset ready for funnel or cohort analysis under '${root}'`)
        }
        if (economicsPath) {
          reviewAssumptions.push(`economicsPath was omitted; auto-selected ${economicsPath} from ${root} because it contains period, type and amount fields`)
          if (selection.economicsCandidates.length > 1) reviewWarnings.push(`Auto-discovery found multiple MRR datasets; selected '${economicsPath}'. Other candidates: ${selection.economicsCandidates.slice(1).join(', ')}`)
        } else {
          reviewWarnings.push(`Auto-discovery found no dataset ready for MRR or unit-economics analysis under '${root}'`)
        }
        if (!eventPath && !economicsPath) reviewWarnings.push(`No usable event or MRR dataset was found under '${root}'; add a supported CSV, JSON or JSONL export and rerun the review`)
      }
      const selectedSources = [eventPath, economicsPath, notePath].filter((path): path is string => Boolean(path))
      emitAnalysisStarted(ctx, 'review', selectedSources.length > 0 ? selectedSources : [args.root?.trim() || config.defaultRoot], args.goal)
      let funnel: FunnelAnalysis | undefined
      let cohort: CohortAnalysis | undefined
      let economics: EconomicsAnalysis | undefined
      let noteAudit: GrowthAuditResult | undefined
      if (eventPath) {
        await ensureInsideRoot(fs, config, eventPath, exec.signal)
        const discovered = discoveredByPath.get(eventPath)
        const dataset = discovered ?? await (growthData?.readDataset(eventPath, exec.signal) ?? readDataset(fs, config, eventPath, exec.signal))
        const profile = discovered?.profile ?? (growthData?.profileDataset(eventPath, dataset.rows, { userField: args.userField, eventField: args.eventField, timeField: args.timeField })
          ?? profileDataset(eventPath, dataset.rows, { userField: args.userField, eventField: args.eventField, timeField: args.timeField }))
        profile.quality.warnings.push(...dataset.warnings)
        profiles.push(profile)
        lineage.push({ source: eventPath, fields: [profile.selectedFields.userField, profile.selectedFields.eventField, profile.selectedFields.timeField].filter((field): field is string => Boolean(field)) })
        const stages = inferStages(profile)
        if (stages.length >= 2 && profile.selectedFields.userField && profile.selectedFields.eventField) {
          funnel = analyzeFunnel(eventPath, dataset.rows, {
            stages,
            userField: profile.selectedFields.userField,
            eventField: profile.selectedFields.eventField,
            channelField: profile.selectedFields.channelField ?? undefined,
            segmentField: profile.selectedFields.segmentField ?? undefined,
            timeField: profile.selectedFields.timeField ?? undefined,
            sequenceMode: 'ordered',
            attribution: 'entry-touch',
            timezone: config.defaultTimezone,
          })
          funnel.warnings.push(...dataset.warnings)
          const acquisition = stages.find((stage) => stage.name === 'Acquisition')
          const retention = stages.find((stage) => stage.name === 'Retention')
          if (acquisition && retention && profile.selectedFields.timeField) {
            cohort = analyzeCohorts(eventPath, dataset.rows, {
              cohortEvent: acquisition.event,
              retentionEvent: retention.event,
              userField: profile.selectedFields.userField,
              eventField: profile.selectedFields.eventField,
              timeField: profile.selectedFields.timeField,
              interval: 'week',
              maxPeriods: 12,
            })
            cohort.warnings.push(...dataset.warnings)
          }
        } else {
          profile.quality.warnings.push('Fewer than two recognizable funnel event values were found; funnel analysis was skipped')
        }
      }
      if (economicsPath) {
        await ensureInsideRoot(fs, config, economicsPath, exec.signal)
        const discovered = discoveredByPath.get(economicsPath)
        const dataset = discovered ?? await (growthData?.readDataset(economicsPath, exec.signal) ?? readDataset(fs, config, economicsPath, exec.signal))
        const profile = discovered?.profile ?? (growthData?.profileDataset(economicsPath, dataset.rows, { periodField: args.periodField, typeField: args.typeField, amountField: args.amountField })
          ?? profileDataset(economicsPath, dataset.rows, { periodField: args.periodField, typeField: args.typeField, amountField: args.amountField }))
        profile.quality.warnings.push(...dataset.warnings)
        profiles.push(profile)
        lineage.push({ source: economicsPath, fields: [profile.selectedFields.periodField, profile.selectedFields.typeField, profile.selectedFields.amountField].filter((field): field is string => Boolean(field)) })
        if (profile.selectedFields.periodField && profile.selectedFields.typeField && profile.selectedFields.amountField) {
          economics = analyzeEconomics(economicsPath, dataset.rows, {
            periodField: profile.selectedFields.periodField,
            typeField: profile.selectedFields.typeField,
            amountField: profile.selectedFields.amountField,
            customerField: profile.selectedFields.customerField ?? 'customer_id',
            spendField: profile.selectedFields.spendField ?? 'spend',
            currency: profile.distinctValues.currencies[0] ?? config.defaultCurrency,
            grossMargin: validGrossMargin(args.grossMargin),
            amountMode: validAmountMode(args.amountMode),
            movementSource: validMovementSource(args.movementSource),
          })
          if (args.grossMargin === undefined) economics.warnings.push('grossMargin was not supplied; LTV uses a 100% gross-margin assumption')
          economics.warnings.push(...dataset.warnings)
        } else {
          profile.quality.warnings.push('Required period/type/amount fields were not all found; economics analysis was skipped')
        }
      }
      if (notePath) {
        await ensureInsideRoot(fs, config, notePath, exec.signal)
        noteAudit = auditGrowthNote(await readNote(fs, notePath, config, exec.signal))
        lineage.push({ source: notePath })
      }
      const review = buildReview({ goal: args.goal, profiles, funnel, cohort, economics, noteAudit, warnings: reviewWarnings })
      emitAnalysisCompleted(ctx, 'review', lineage.map((item) => item.source), review.warnings.length)
      review.warnings.forEach((message) => ctx.emit('growth/warning', { kind: 'review', message }))
      return wrapResult(review, { lineage, assumptions: reviewAssumptions, nextActions: review.nextActions })
    },
  }))

  ctx.tools.register(defineTool({
    name: 'growth_funnel_analyze',
    description: 'Analyze an event dataset as an AARRR-style funnel, with conversion, drop-off, channel and segment comparisons.',
    parameters: {
      sourcePath: { type: 'string', required: true, description: 'CSV, JSON or JSONL event dataset path.' },
      stages: { type: 'string', description: 'Comma-separated stage=event pairs or a JSON array.' },
      userField: { type: 'string', description: 'User ID field; defaults to user_id.' },
      eventField: { type: 'string', description: 'Event name field; defaults to event.' },
      channelField: { type: 'string', description: 'Optional acquisition channel field.' },
      segmentField: { type: 'string', description: 'Optional user segment field.' },
      timeField: { type: 'string', description: 'Timestamp/date field; defaults to timestamp.' },
      start: { type: 'string', description: 'Optional ISO start date.' },
      end: { type: 'string', description: 'Optional ISO end date.' },
      sequenceMode: { type: 'string', description: 'any-event counts event presence; ordered requires the stage sequence.' },
      conversionWindowDays: { type: 'number', description: 'Optional positive window from entry to final stage, in days.' },
      attribution: { type: 'string', description: 'first-touch, last-touch or entry-touch channel attribution.' },
    },
    output: growthOutput(config.maxResultChars),
    async execute(args, exec) {
      await ensureInsideRoot(fs, config, args.sourcePath, exec.signal)
      const dataset = await readDataset(fs, config, args.sourcePath, exec.signal)
      const stages = parseStages(args.stages)
      if (stages.length < 2) throw new Error('stages must contain at least two valid stage/event pairs')
      const result = analyzeFunnel(args.sourcePath, dataset.rows, {
        stages,
        userField: args.userField?.trim() || 'user_id',
        eventField: args.eventField?.trim() || 'event',
        channelField: args.channelField?.trim() || undefined,
        segmentField: args.segmentField?.trim() || undefined,
        timeField: args.timeField?.trim() || 'timestamp',
        start: args.start,
        end: args.end,
        sequenceMode: validSequenceMode(args.sequenceMode),
        conversionWindowDays: validWindow(args.conversionWindowDays),
        attribution: validAttribution(args.attribution),
        timezone: config.defaultTimezone,
      })
      result.warnings.push(...dataset.warnings)
      return wrapResult(result, {
        lineage: [{ source: args.sourcePath, fields: [args.userField?.trim() || 'user_id', args.eventField?.trim() || 'event', args.timeField?.trim() || 'timestamp'], window: { start: args.start, end: args.end, timezone: config.defaultTimezone } }],
        assumptions: [validSequenceMode(args.sequenceMode) === 'ordered' ? 'Ordered mode requires each stage to occur after the previous stage for the same user.' : 'Any-event mode counts distinct users who have each event, regardless of event order.'],
      })
    },
  }))

  ctx.tools.register(defineTool({
    name: 'growth_cohort_analyze',
    description: 'Analyze retention cohorts from an event dataset by day, week or month, including lifecycle counts.',
    parameters: {
      sourcePath: { type: 'string', required: true, description: 'CSV, JSON or JSONL event dataset path.' },
      cohortEvent: { type: 'string', required: true, description: 'Event defining cohort entry, such as signup.' },
      retentionEvent: { type: 'string', required: true, description: 'Event defining retained activity, such as active.' },
      userField: { type: 'string', description: 'User ID field; defaults to user_id.' },
      eventField: { type: 'string', description: 'Event name field; defaults to event.' },
      timeField: { type: 'string', description: 'Timestamp field; defaults to timestamp.' },
      interval: { type: 'string', description: 'day, week or month; defaults to week.' },
      maxPeriods: { type: 'number', description: 'Maximum retention periods; defaults to 12.' },
    },
    output: growthOutput(config.maxResultChars),
    async execute(args, exec) {
      await ensureInsideRoot(fs, config, args.sourcePath, exec.signal)
      const dataset = await readDataset(fs, config, args.sourcePath, exec.signal)
      const result = analyzeCohorts(args.sourcePath, dataset.rows, {
        cohortEvent: args.cohortEvent,
        retentionEvent: args.retentionEvent,
        userField: args.userField?.trim() || 'user_id',
        eventField: args.eventField?.trim() || 'event',
        timeField: args.timeField?.trim() || 'timestamp',
        interval: validInterval(args.interval),
        maxPeriods: validMaxPeriods(args.maxPeriods),
        timezone: config.defaultTimezone,
      })
      result.warnings.push(...dataset.warnings)
      return wrapResult(result, {
        lineage: [{ source: args.sourcePath, fields: [args.userField?.trim() || 'user_id', args.eventField?.trim() || 'event', args.timeField?.trim() || 'timestamp'], window: { timezone: config.defaultTimezone } }],
      })
    },
  }))

  ctx.tools.register(defineTool({
    name: 'growth_economics',
    description: 'Calculate MRR bridge, ARR, ARPA, churn, NRR, CAC, LTV and payback from period movement rows.',
    parameters: {
      sourcePath: { type: 'string', required: true, description: 'CSV, JSON or JSONL MRR/cost dataset path.' },
      periodField: { type: 'string', description: 'Period field; defaults to period.' },
      typeField: { type: 'string', description: 'Movement type field; defaults to type.' },
      amountField: { type: 'string', description: 'MRR movement amount field; defaults to amount.' },
      customerField: { type: 'string', description: 'Customer ID field; defaults to customer_id.' },
      spendField: { type: 'string', description: 'Acquisition spend field; defaults to spend.' },
      currency: { type: 'string', description: 'Currency code; defaults to configured currency.' },
      grossMargin: { type: 'number', description: 'Gross margin ratio, such as 0.8. Omit to use 1.0 with a warning.' },
      amountMode: { type: 'string', description: 'absolute treats contraction/churn as magnitudes; signed expects input signs to carry the direction.' },
      movementSource: { type: 'string', description: 'movement for bridge rows; snapshot for ending-MRR snapshots.' },
      beginningMrr: { type: 'number', description: 'Optional beginning MRR before the first supplied period.' },
      beginningCustomers: { type: 'number', description: 'Optional beginning customer count.' },
    },
    output: growthOutput(config.maxResultChars),
    async execute(args, exec) {
      await ensureInsideRoot(fs, config, args.sourcePath, exec.signal)
      const dataset = await readDataset(fs, config, args.sourcePath, exec.signal)
      const result = analyzeEconomics(args.sourcePath, dataset.rows, {
        periodField: args.periodField?.trim() || 'period',
        typeField: args.typeField?.trim() || 'type',
        amountField: args.amountField?.trim() || 'amount',
        customerField: args.customerField?.trim() || 'customer_id',
        spendField: args.spendField?.trim() || 'spend',
        currency: args.currency?.trim() || config.defaultCurrency,
        grossMargin: validGrossMargin(args.grossMargin),
        amountMode: validAmountMode(args.amountMode),
        movementSource: validMovementSource(args.movementSource),
        beginningMrr: args.beginningMrr,
        beginningCustomers: args.beginningCustomers,
      })
      if (args.grossMargin === undefined) result.warnings.push('grossMargin was not supplied; LTV uses a 100% gross-margin assumption')
      result.warnings.push(...dataset.warnings)
      return wrapResult(result, {
        lineage: [{ source: args.sourcePath, fields: [args.periodField?.trim() || 'period', args.typeField?.trim() || 'type', args.amountField?.trim() || 'amount'] }],
        assumptions: [args.grossMargin === undefined ? 'grossMargin defaults to 1.0 when omitted.' : `grossMargin=${args.grossMargin}`, `amountMode=${validAmountMode(args.amountMode)}`, `movementSource=${validMovementSource(args.movementSource)}`],
      })
    },
  }))

  ctx.tools.register(defineTool({
    name: 'growth_diagnose',
    description: 'Diagnose a metric change using evidence, stage context and explicit data gaps. It does not claim causality without supporting data.',
    parameters: {
      metric: { type: 'string', required: true, description: 'Metric name.' },
      current: { type: 'number', required: true, description: 'Current metric value.' },
      previous: { type: 'number', required: true, description: 'Previous or baseline metric value.' },
      stage: { type: 'string', description: 'AARRR stage, such as retention or revenue.' },
      context: { type: 'string', description: 'Optional context about product, channel or recent changes.' },
      path: { type: 'string', description: 'Optional growth Markdown note to audit for metric quality.' },
    },
    output: growthOutput(config.maxResultChars),
    async execute(args, exec) {
      let audit
      if (args.path?.trim()) {
        await ensureInsideRoot(fs, config, args.path, exec.signal)
        audit = auditGrowthNote(await readNote(fs, args.path, config, exec.signal))
      }
      return wrapResult(diagnoseGrowth({ metric: args.metric, current: args.current, previous: args.previous, stage: args.stage, context: args.context, audit }), {
        lineage: args.path ? [{ source: args.path }] : [],
      })
    },
  }))

  ctx.tools.register(defineTool({
    name: 'growth_experiment',
    description: 'Create a HADI growth experiment card with primary metric, guardrails, instrumentation and optional RICE/ICE score.',
    parameters: {
      title: { type: 'string', required: true, description: 'Experiment title.' },
      problem: { type: 'string', required: true, description: 'Observed growth problem.' },
      hypothesis: { type: 'string', required: true, description: 'Falsifiable if/then hypothesis.' },
      stage: { type: 'string', required: true, description: 'acquisition, activation, retention, referral or revenue.' },
      targetMetric: { type: 'string', required: true, description: 'Primary metric.' },
      guardrails: { type: 'string', description: 'Comma-separated guardrail metrics.' },
      owner: { type: 'string', description: 'Experiment owner.' },
      audience: { type: 'string', description: 'Target audience or segment.' },
      durationDays: { type: 'number', description: 'Experiment duration; defaults to 14.' },
      reach: { type: 'number', description: 'RICE reach estimate.' },
      impact: { type: 'number', description: 'RICE/ICE impact estimate.' },
      confidence: { type: 'number', description: 'RICE/ICE confidence ratio, such as 0.8.' },
      effort: { type: 'number', description: 'RICE effort estimate.' },
      ease: { type: 'number', description: 'ICE ease estimate.' },
      method: { type: 'string', description: 'rice or ice; defaults to rice.' },
    },
    output: growthOutput(config.maxResultChars),
    async execute(args) {
      const method = validMethod(args.method)
      return wrapResult(createExperiment({
        title: args.title,
        problem: args.problem,
        hypothesis: args.hypothesis,
        stage: validStage(args.stage),
        targetMetric: args.targetMetric,
        guardrails: parseGuardrails(args.guardrails),
        owner: args.owner,
        audience: args.audience,
        durationDays: args.durationDays,
        reach: args.reach,
        impact: args.impact,
        confidence: args.confidence,
        effort: args.effort,
        ease: args.ease,
        method,
      }), { nextActions: ['Record the experiment owner, launch date, decision date and instrumentation before starting.'] })
    },
  }))

  ctx.tools.register(defineTool({
    name: 'growth_prioritize',
    description: 'Rank growth opportunities using RICE or ICE from a JSON array of scored opportunity objects.',
    parameters: {
      items: { type: 'string', required: true, description: 'JSON array with title, method, reach, impact, confidence, effort/ease, evidence and targetMetric.' },
    },
    output: growthOutput(config.maxResultChars),
    async execute(args) {
      const items = priorityItems(args.items).toSorted((left, right) => (right.score ?? -1) - (left.score ?? -1)).map((item, index) => ({ rank: index + 1, ...item }))
      return wrapResult({ generatedAt: new Date().toISOString(), items, warnings: items.some((item) => item.score === null) ? ['Some items lack enough inputs for a numeric priority score'] : [] }, {
        nextActions: ['Validate the evidence and target metric for the top-ranked opportunity before committing delivery capacity.'],
      })
    },
  }))

  ctx.tools.register(defineTool({
    name: 'growth_report',
    description: 'Generate a WBR, MBR, QBR or experiment-review Markdown report from explicit metrics, findings, experiments and actions.',
    parameters: {
      title: { type: 'string', required: true, description: 'Report title.' },
      reportType: { type: 'string', description: 'wbr, mbr, qbr or experiment-review.' },
      period: { type: 'string', required: true, description: 'Report period.' },
      summary: { type: 'string', description: 'Answer-first summary; optional when reviewJson is supplied.' },
      reviewJson: { type: 'string', description: 'Optional JSON from growth_review; automatically maps analyses, findings, caveats and sources into the report.' },
      metrics: { type: 'string', description: 'JSON array of metric rows with name/current/previous/delta/source.' },
      findings: { type: 'string', description: 'Newline-separated findings.' },
      experiments: { type: 'string', description: 'Newline-separated experiments or decisions.' },
      nextActions: { type: 'string', description: 'Newline-separated next actions.' },
      caveats: { type: 'string', description: 'Newline-separated caveats.' },
    },
    output: growthOutput(config.maxResultChars),
    async execute(args) {
      const review = args.reviewJson ? reportInputFromReview(args.reviewJson) : undefined
      const metrics = review?.metrics ?? (args.metrics ? JSON.parse(args.metrics) as Array<{ name: string; current: string; previous?: string; delta?: string; source?: string }> : [])
      const report = renderReport({
        title: args.title,
        reportType: validReportType(args.reportType),
        period: args.period,
        summary: args.summary ?? review?.summary ?? '',
        metrics,
        findings: review?.findings ?? parseList(args.findings?.replace(/\n/g, ',')),
        experiments: review?.experiments ?? parseList(args.experiments?.replace(/\n/g, ',')),
        nextActions: review?.nextActions ?? parseList(args.nextActions?.replace(/\n/g, ',')),
        caveats: review?.caveats ?? parseList(args.caveats?.replace(/\n/g, ',')),
      })
      ctx.emit('growth/report-previewed', { sourceCount: review?.sources.length ?? 0 })
      return wrapResult(report, {
        assumptions: [review ? 'The report was assembled from the supplied growth_review result; it does not infer causality.' : 'The report uses only the explicitly supplied metrics and findings; it does not infer causality.'],
        lineage: review?.sources.map((source) => ({ source })) ?? [],
      })
    },
  }))

  ctx.tools.register(defineTool({
    name: 'growth_apply',
    description: 'Preview or apply a complete Markdown replacement under defaultRoot using a stale-version guard. Set confirm=true only after explicit approval.',
    parameters: {
      path: { type: 'string', required: true, description: 'Markdown file to update.' },
      content: { type: 'string', required: true, description: 'Complete replacement Markdown content.' },
      confirm: { type: 'boolean', required: true, description: 'false previews only; true applies the guarded write.' },
    },
    output: growthOutput(config.maxResultChars),
    async execute(args, exec) {
      await ensureInsideRoot(fs, config, args.path, exec.signal)
      if (args.content.length > config.maxTextChars) throw new Error(`Replacement exceeds maxTextChars (${config.maxTextChars})`)
      const target = await fs.resolve(args.path, { signal: exec.signal })
      const info = await fs.stat(target, exec.signal)
      if (!info || info.type !== 'file') throw new Error(`File not found: ${args.path}`)
      const current = await fs.readText(target, exec.signal)
      if (!args.confirm) {
        ctx.emit('growth/report-previewed', { path: args.path, sourceCount: 1 })
        return wrapResult({ status: 'preview-only', path: args.path, changed: args.content !== current, applied: false, title: parseNote(args.path, args.content).title, diff: replacementDiff(current, args.content) }, {
        nextActions: ['Review the proposed replacement and call again with confirm=true only after explicit approval.'],
        })
      }
      await fs.writeText(target, args.content, { kind: 'replaceIfVersion', version: info.version }, exec.signal)
      ctx.emit('growth/report-applied', { path: args.path })
      return wrapResult({ status: 'applied', path: args.path, changed: args.content !== current, applied: true, guarded: true }, { lineage: [{ source: args.path }] })
    },
  }))

  ctx.logger.info(`[dsh-growth] registered growth tools for ${config.defaultRoot}`)
}
