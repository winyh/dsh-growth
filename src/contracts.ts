import type { GrowthHandoffContext, GrowthMetricContractReview } from './types.js'

function text(value: unknown): string {
  return value === undefined || value === null ? '' : String(value).trim()
}

function list(value: unknown): string[] {
  return Array.isArray(value) ? value.map(text).filter(Boolean) : []
}

export function consumeGrowthHandoff(input: Record<string, unknown>): GrowthHandoffContext {
  const warnings: string[] = []
  if (input.artifactType !== 'growth-handoff') warnings.push('artifactType 不是 growth-handoff。')
  const productName = text(input.productName)
  const primaryMetric = text(input.primaryMetric)
  const evidence = list(input.evidence)
  const guardrails = list(input.guardrails)
  const openQuestions = list(input.openQuestions)
  if (!productName) warnings.push('缺少 productName。')
  if (!primaryMetric) warnings.push('缺少 primaryMetric。')
  if (evidence.length === 0) warnings.push('缺少产品结果证据。')
  const status = warnings.some((item) => item.includes('artifactType')) ? 'blocked' : warnings.length > 0 ? 'partial' : 'ready'
  return { artifactType: 'growth-handoff-consumption', schemaVersion: '1.0', productName, primaryMetric, guardrails, evidence, openQuestions, status, warnings, nextActions: status === 'ready' ? ['按 primaryMetric、guardrails、window 和数据源运行 growth_review。'] : ['补齐产品结果、主指标、护栏指标和来源后再启动增长复盘。'] }
}

export function buildMetricContractReview(input: { metrics: unknown[]; timezone: string; currency: string }): GrowthMetricContractReview {
  const warnings: string[] = []
  const metrics = input.metrics.flatMap((item, index) => {
    if (typeof item !== 'object' || item === null) { warnings.push(`metric ${index + 1} 不是对象。`); return [] }
    const record = item as Record<string, unknown>
    const name = text(record.name)
    const event = text(record.event ?? record.eventName)
    const window = text(record.window ?? record.observationWindow)
    const timezone = text(record.timezone) || input.timezone
    const currency = text(record.currency) || undefined
    const status = name && event && window && timezone ? 'ready' as const : 'partial' as const
    if (status === 'partial') warnings.push(`${name || `metric ${index + 1}`} 缺少 name、event、window 或 timezone。`)
    return [{ name, event, window, timezone, ...(currency ? { currency } : {}), status }]
  })
  return { artifactType: 'growth-metric-contract', schemaVersion: '1.0', generatedAt: new Date().toISOString(), metrics, warnings, nextActions: warnings.length > 0 ? [`补齐指标定义；默认币种为 ${input.currency}，默认时区为 ${input.timezone}。`] : ['将指标契约绑定到事件数据和 growth_review 的 lineage。'] }
}
