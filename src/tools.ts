import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
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
import { readNote, scanGrowthVault } from './vault.js'
import type { FileSystemLike, GrowthConfig, PriorityItem, PriorityMethod, ReportType } from './types.js'

function asJson(value: unknown, maxChars: number): string {
  const text = JSON.stringify(value, null, 2)
  return text.length > maxChars ? `${text.slice(0, maxChars)}\n... result truncated by dsh-growth ...` : text
}

function fsFrom(ctx: Context): FileSystemLike {
  return (ctx as unknown as { fs: FileSystemLike }).fs
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
    const method = record.method === 'ice' ? 'ice' : 'rice'
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
  return value === 'day' || value === 'month' ? value : 'week'
}

function validStage(value: string | undefined): 'acquisition' | 'activation' | 'retention' | 'referral' | 'revenue' {
  if (value === 'acquisition' || value === 'retention' || value === 'referral' || value === 'revenue') return value
  return 'activation'
}

function validReportType(value: string | undefined): ReportType {
  if (value === 'mbr' || value === 'qbr' || value === 'experiment-review') return value
  return 'wbr'
}

export function registerGrowthTools(ctx: Context, config: GrowthConfig): void {
  const fs = fsFrom(ctx)

  ctx.tools.register(defineTool({
    name: 'growth_audit_note',
    description: 'Audit one Markdown growth note for JTBD, PMF, North Star, AARRR, metrics, evidence and experiment readiness. Reads only.',
    parameters: {
      path: { type: 'string', required: true, description: 'Absolute or workspace-relative Markdown path.' },
    },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    async execute(args, exec) {
      await ensureInsideRoot(fs, config, args.path, exec.signal)
      const note = await readNote(fs, args.path, config, exec.signal)
      return asJson(auditGrowthNote(note), config.maxResultChars)
    },
  }))

  ctx.tools.register(defineTool({
    name: 'growth_audit_vault',
    description: 'Scan a local Markdown knowledge base for growth-project, metric, experiment, channel and report quality gaps. Reads only.',
    parameters: {
      root: { type: 'string', description: 'Optional directory under defaultRoot.' },
    },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    async execute(args, exec) {
      const root = args.root?.trim() || config.defaultRoot
      await ensureInsideRoot(fs, config, root, exec.signal)
      return asJson(await scanGrowthVault(fs, root, config, exec.signal), config.maxResultChars)
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
      start: { type: 'string', description: 'Optional ISO start date.' },
      end: { type: 'string', description: 'Optional ISO end date.' },
    },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    async execute(args, exec) {
      await ensureInsideRoot(fs, config, args.sourcePath, exec.signal)
      const dataset = await readDataset(fs, config, args.sourcePath, exec.signal)
      const result = analyzeFunnel(args.sourcePath, dataset.rows, {
        stages: parseStages(args.stages),
        userField: args.userField?.trim() || 'user_id',
        eventField: args.eventField?.trim() || 'event',
        channelField: args.channelField?.trim() || undefined,
        segmentField: args.segmentField?.trim() || undefined,
        start: args.start,
        end: args.end,
      })
      result.warnings.push(...dataset.warnings)
      return asJson(result, config.maxResultChars)
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
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
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
        maxPeriods: Math.min(52, Math.max(1, Math.floor(args.maxPeriods ?? 12))),
      })
      result.warnings.push(...dataset.warnings)
      return asJson(result, config.maxResultChars)
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
      beginningMrr: { type: 'number', description: 'Optional beginning MRR before the first supplied period.' },
      beginningCustomers: { type: 'number', description: 'Optional beginning customer count.' },
    },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
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
        grossMargin: args.grossMargin ?? 1,
        beginningMrr: args.beginningMrr,
        beginningCustomers: args.beginningCustomers,
      })
      if (args.grossMargin === undefined) result.warnings.push('grossMargin was not supplied; LTV uses a 100% gross-margin assumption')
      result.warnings.push(...dataset.warnings)
      return asJson(result, config.maxResultChars)
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
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    async execute(args, exec) {
      let audit
      if (args.path?.trim()) {
        await ensureInsideRoot(fs, config, args.path, exec.signal)
        audit = auditGrowthNote(await readNote(fs, args.path, config, exec.signal))
      }
      return asJson(diagnoseGrowth({ metric: args.metric, current: args.current, previous: args.previous, stage: args.stage, context: args.context, audit }), config.maxResultChars)
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
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    async execute(args) {
      const method: PriorityMethod = args.method === 'ice' ? 'ice' : 'rice'
      return asJson(createExperiment({
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
      }), config.maxResultChars)
    },
  }))

  ctx.tools.register(defineTool({
    name: 'growth_prioritize',
    description: 'Rank growth opportunities using RICE or ICE from a JSON array of scored opportunity objects.',
    parameters: {
      items: { type: 'string', required: true, description: 'JSON array with title, method, reach, impact, confidence, effort/ease, evidence and targetMetric.' },
    },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    async execute(args) {
      const items = priorityItems(args.items).toSorted((left, right) => (right.score ?? -1) - (left.score ?? -1)).map((item, index) => ({ rank: index + 1, ...item }))
      return asJson({ generatedAt: new Date().toISOString(), items, warnings: items.some((item) => item.score === null) ? ['Some items lack enough inputs for a numeric priority score'] : [] }, config.maxResultChars)
    },
  }))

  ctx.tools.register(defineTool({
    name: 'growth_report',
    description: 'Generate a WBR, MBR, QBR or experiment-review Markdown report from explicit metrics, findings, experiments and actions.',
    parameters: {
      title: { type: 'string', required: true, description: 'Report title.' },
      reportType: { type: 'string', description: 'wbr, mbr, qbr or experiment-review.' },
      period: { type: 'string', required: true, description: 'Report period.' },
      summary: { type: 'string', required: true, description: 'Answer-first summary.' },
      metrics: { type: 'string', description: 'JSON array of metric rows with name/current/previous/delta/source.' },
      findings: { type: 'string', description: 'Newline-separated findings.' },
      experiments: { type: 'string', description: 'Newline-separated experiments or decisions.' },
      nextActions: { type: 'string', description: 'Newline-separated next actions.' },
      caveats: { type: 'string', description: 'Newline-separated caveats.' },
    },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    async execute(args) {
      const metrics = args.metrics ? JSON.parse(args.metrics) as Array<{ name: string; current: string; previous?: string; delta?: string; source?: string }> : []
      return renderReport({
        title: args.title,
        reportType: validReportType(args.reportType),
        period: args.period,
        summary: args.summary,
        metrics,
        findings: parseList(args.findings?.replace(/\n/g, ',')),
        experiments: parseList(args.experiments?.replace(/\n/g, ',')),
        nextActions: parseList(args.nextActions?.replace(/\n/g, ',')),
        caveats: parseList(args.caveats?.replace(/\n/g, ',')),
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
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    async execute(args, exec) {
      await ensureInsideRoot(fs, config, args.path, exec.signal)
      if (args.content.length > config.maxTextChars) throw new Error(`Replacement exceeds maxTextChars (${config.maxTextChars})`)
      const target = await fs.resolve(args.path, { signal: exec.signal })
      const info = await fs.stat(target, exec.signal)
      if (!info || info.type !== 'file') throw new Error(`File not found: ${args.path}`)
      const current = await fs.readText(target, exec.signal)
      if (!args.confirm) return asJson({ status: 'preview-only', path: args.path, changed: args.content !== current, applied: false, preview: parseNote(args.path, args.content).title }, config.maxResultChars)
      await fs.writeText(target, args.content, { kind: 'replaceIfVersion', version: info.version }, exec.signal)
      return asJson({ status: 'applied', path: args.path, changed: args.content !== current, applied: true, guarded: true }, config.maxResultChars)
    },
  }))

  console.log(`[dsh-growth] registered growth tools for ${config.defaultRoot}`)
}
