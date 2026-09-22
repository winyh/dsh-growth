import { reviewArtifact } from './artifacts.js'
import { validDate } from './artifact-integrity.js'
import { asRecord } from './handoff-receive.js'

function window(value: unknown): [number, number] | undefined {
  if (typeof value !== 'string') return undefined
  const parts = value.split('/')
  if (parts.length !== 2 || !parts.every(validDate)) return undefined
  const start = Date.parse(parts[0]!)
  const end = Date.parse(parts[1]!) + (parts[1]!.length === 10 ? 86_399_999 : 0)
  return start <= end ? [start, end] : undefined
}
export function reviewGrowthAttribution(value: unknown, metrics: unknown) {
  const envelope = asRecord(value)
  const raw = Object.hasOwn(envelope, 'data') ? envelope.data : value
  const plans = Array.isArray(raw) ? raw : [raw]
  if (!Array.isArray(metrics)) throw new Error('metricsJson must be an array')
  const warnings: string[] = ['仅表示观察到的指标变化，不证明内容导致增长；仍需检查样本量、分群、护栏与对照。']
  if (!plans.length) warnings.push('没有测量计划。')
  const results = plans.map(value => {
    const plan = asRecord(value)
    const review = reviewArtifact(plan, 'geo-growth-measurement-plan')
    const issues = [...review.issues]
    if (Object.hasOwn(envelope, 'data') && envelope.ok !== true) issues.push('来源工具失败。')
    if (review.status !== 'ready') issues.push('测量计划未通过完整性和有效期审查。')
    if (plan.handoffFrom !== 'dsh-geo' || plan.handoffTo !== 'dsh-growth') issues.push('测量计划路由不正确。')
    for (const key of ['contentId', 'channel', 'targetMetric', 'source']) if (typeof plan[key] !== 'string' || !String(plan[key]).trim()) issues.push('缺少 ' + key)
    const baseline = window(plan.baselineWindow)
    if (!baseline || !validDate(plan.publishAt) || baseline[1] >= Date.parse(plan.publishAt)) issues.push('基线窗口无效或与发布期重叠。')
    const matches = metrics.map(asRecord).filter(row => row.contentId === plan.contentId && row.channel === plan.channel && row.metric === plan.targetMetric)
    const seen = new Set<string>()
    const deltas: Array<{ window: string; delta: number; value: number; baseline: number; unit: string; source: string }> = []
    for (const row of matches) {
      const observation = window(row.window)
      const key = String(row.window)
      if (seen.has(key)) { issues.push('同一观察窗口存在重复或冲突记录，先去重或明确分群。'); continue }
      seen.add(key)
      if (!observation || !validDate(plan.publishAt) || observation[0] < Date.parse(plan.publishAt) || observation[1] > Date.now()
        || !baseline || observation[0] <= baseline[1]) { issues.push('观察窗口无效、尚未结束或与基线/发布前时段重叠。'); continue }
      if (typeof row.value !== 'number' || !Number.isFinite(row.value) || typeof row.baseline !== 'number' || !Number.isFinite(row.baseline)
        || !Number.isFinite(row.value - row.baseline)) { issues.push('value/baseline 必须是有限数字。'); continue }
      if (typeof row.source !== 'string' || !row.source.trim() || typeof row.unit !== 'string' || !row.unit.trim()
        || row.baselineWindow !== plan.baselineWindow || (row.baselineUnit !== undefined && row.baselineUnit !== row.unit)) {
        issues.push('需要可追溯 source、统一 unit，以及与计划一致的 baselineWindow。'); continue
      }
      deltas.push({ window: String(row.window), delta: row.value - row.baseline, value: row.value, baseline: row.baseline, unit: row.unit, source: row.source })
    }
    return {
      planArtifactId: String(plan.artifactId ?? ''), planContentHash: String(plan.contentHash ?? ''),
      contentId: String(plan.contentId ?? ''), channel: String(plan.channel ?? ''), targetMetric: String(plan.targetMetric ?? ''),
      status: review.status === 'blocked' || review.status === 'stale' ? 'blocked' : !matches.length ? 'unmeasured' : issues.length ? 'partial' : 'measured',
      observations: matches.length, comparableObservations: deltas.length, deltas, issues,
    }
  })
  const status = results.some(result => result.status === 'blocked') ? 'blocked'
    : results.length > 0 && results.every(result => result.status === 'measured') ? 'measured' : 'partial'
  return {
    artifactType: 'growth-attribution-review', generatedAt: new Date().toISOString(), status, causality: 'not-established',
    results, warnings: [...warnings, ...results.flatMap(result => result.issues)],
    nextActions: status === 'measured' ? ['把观察到的变化回传内容与业务负责人；指标下降或无变化也要保留，不能只展示正向结果。']
      : ['补齐或修正来源、窗口、单位、基线与去重问题，再复盘；没有数据不是零增长。'],
  }
}
