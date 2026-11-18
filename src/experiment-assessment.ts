import { validDate } from './artifact-integrity.js'
import { reviewArtifact } from './artifacts.js'
import { asRecord } from './handoff-receive.js'

interface MetricRule {
  metric: string
  unit: string
  direction: 'at-least' | 'at-most'
  threshold: number
  minPerGroup: number
}

function positiveCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function metricRule(value: unknown): MetricRule {
  const { metric, unit, direction, threshold, minPerGroup = 1 } = asRecord(value)
  if (typeof metric !== 'string' || !metric.trim() || typeof unit !== 'string' || !unit.trim()
    || (direction !== 'at-least' && direction !== 'at-most') || !finite(threshold) || !positiveCount(minPerGroup)) {
    throw new Error('Each rule needs metric, unit, direction (at-least or at-most), finite threshold and positive integer minPerGroup.')
  }
  if (unit.trim() === 'pp' && Math.abs(threshold) > 100) throw new Error('Percentage-point thresholds must be within -100 to 100.')
  return { metric: metric.trim(), unit: unit.trim(), direction, threshold, minPerGroup }
}

export function experimentCriteria(value: unknown, targetMetric: string, guardrailNames: string[]) {
  const { start, end, primary, guardrails } = asRecord(value)
  if (!validDate(start) || !validDate(end) || Date.parse(start) >= Date.parse(end)) {
    throw new Error('Supply a valid ISO observation window with start before end (end exclusive).')
  }
  const main = metricRule(primary)
  if (!Array.isArray(guardrails) || !guardrails.length) throw new Error('Provide at least one guardrail threshold.')
  const guards = guardrails.map(metricRule)
  const names = guards.map(rule => rule.metric)
  if (main.metric !== targetMetric.trim() || new Set([main.metric, ...names]).size !== names.length + 1) {
    throw new Error('Primary rule must match targetMetric; all metrics must be unique.')
  }
  if (guardrailNames.length && (guardrailNames.length !== names.length || !names.every(name => guardrailNames.includes(name)))) {
    throw new Error('guardrails must match the registered guardrail rules.')
  }
  return { start: new Date(start).toISOString(), end: new Date(end).toISOString(), primary: main, guardrails: guards }
}

// Decimal input such as 4.2 - 4.1 should meet an inclusive 0.1 threshold.
function decimalParts(value: number) {
  const [mantissa, exponent = '0'] = String(value).split('e')
  const [whole, fraction = ''] = mantissa!.split('.')
  return { coefficient: BigInt(whole + fraction), exponent: Number(exponent) - fraction.length }
}

function measuredDelta(treatment: number, control: number) {
  const a = decimalParts(treatment)
  const b = decimalParts(control)
  const scale = Math.min(a.exponent, b.exponent)
  const difference = a.coefficient * 10n ** BigInt(a.exponent - scale) - b.coefficient * 10n ** BigInt(b.exponent - scale)
  return Number(difference.toString() + 'e' + scale)
}

function grade(rule: MetricRule, role: 'primary' | 'guardrail', rows: Record<string, unknown>[], unavailable: string) {
  const definition = { role, ...rule }
  const insufficient = (reason: string) => ({ ...definition, status: 'insufficient-data' as const, reason })
  if (unavailable) return insufficient(unavailable)
  const matches = rows.filter(row => row.metric === rule.metric)
  if (matches.length !== 1) return insufficient(matches.length ? 'Duplicate observations' : 'Missing observation')
  const { unit, control, treatment, controlN, treatmentN, source } = matches[0]!
  if (unit !== rule.unit || typeof source !== 'string' || !source.trim()) return insufficient('Missing source or mismatched unit')
  if (!positiveCount(controlN) || !positiveCount(treatmentN) || Math.min(controlN, treatmentN) < rule.minPerGroup) {
    return insufficient('Insufficient sample in control or treatment group')
  }
  if (!finite(control) || !finite(treatment) || !finite(treatment - control)) return insufficient('Missing or invalid group value')
  if (unit === 'pp' && (Math.min(control, treatment) < 0 || Math.max(control, treatment) > 100)) {
    return insufficient('Percentage-point comparisons require rates from 0 to 100')
  }
  const delta = measuredDelta(treatment, control)
  const meets = rule.direction === 'at-least' ? delta >= rule.threshold : delta <= rule.threshold
  const status = meets ? 'met' : role === 'primary' ? 'missed' : 'breached'
  return { ...definition, status, control, treatment, controlN, treatmentN, delta, source }
}

export function assessExperiment(value: unknown, evidence: unknown) {
  const envelope = asRecord(value)
  if ('data' in envelope && envelope.ok !== true) throw new Error('Experiment plan came from an unsuccessful result.')
  const plan = asRecord('data' in envelope ? envelope.data : value)
  const review = reviewArtifact(plan, 'growth-experiment-plan')
  // The original design is a historical record, not a time-sensitive observation.
  if (plan.hashVersion !== 'sha256-v2' || review.status !== 'ready' || typeof plan.targetMetric !== 'string' || !validDate(plan.generatedAt)) {
    throw new Error('Expected the original checksummed preregistered experiment plan.')
  }
  const criteria = experimentCriteria(plan.criteria, plan.targetMetric, [])
  if (Date.parse(plan.generatedAt) >= Date.parse(criteria.start)) throw new Error('Plan must be registered before the observation window.')
  const pending = Date.now() < Date.parse(criteria.end)
  const batch = asRecord(evidence)
  let unavailable = ''
  if (batch.planHash !== plan.contentHash) unavailable = 'Evidence must reference the original plan contentHash'
  else if (!validDate(batch.start) || !validDate(batch.end) || Date.parse(batch.start) !== Date.parse(criteria.start)
    || Date.parse(batch.end) !== Date.parse(criteria.end)) unavailable = 'Evidence must cover the registered observation window'
  const rows = Array.isArray(batch.rows) ? batch.rows.map(asRecord) : []
  const rules = [{ role: 'primary' as const, rule: criteria.primary },
    ...criteria.guardrails.map(rule => ({ role: 'guardrail' as const, rule }))]
  const metrics = rules.map(({ role, rule }) => pending
    ? { role, ...rule, status: 'pending', reason: 'Observation window is still open' }
    : grade(rule, role, rows, unavailable))
  const status = pending ? 'pending' : metrics.some(row => row.status === 'breached') ? 'breached'
    : metrics.some(row => row.status === 'missed') ? 'missed'
    : metrics.some(row => row.status === 'insufficient-data') ? 'insufficient-data' : 'met'
  return { artifactType: 'growth-experiment-assessment', title: plan.title, planArtifactId: plan.artifactId,
    planHash: plan.contentHash, start: criteria.start, end: criteria.end, status, metrics }
}
