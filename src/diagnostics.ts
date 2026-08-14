import { percentage, safeDivide } from './metrics.js'
import type { DiagnosticResult, GrowthAuditResult } from './types.js'

export interface DiagnosticOptions {
  metric: string
  current: number
  previous: number
  stage?: string
  context?: string
  audit?: GrowthAuditResult
}

export function diagnoseGrowth(options: DiagnosticOptions): DiagnosticResult {
  const delta = options.current - options.previous
  const deltaRate = percentage(safeDivide(delta, options.previous))
  const direction = delta > 0 ? '上升' : delta < 0 ? '下降' : '持平'
  const hypotheses: DiagnosticResult['hypotheses'] = []
  const stage = options.stage?.toLowerCase() ?? ''
  if (stage.includes('acquisition') || stage.includes('获客')) hypotheses.push({ rank: 1, hypothesis: '渠道流量或渠道质量发生变化', evidence: ['当前指标被标记为获客阶段'], confidence: 'medium', nextCheck: '按渠道比较有效用户、激活率和 CAC，而不是只看访问量' })
  if (stage.includes('activation') || stage.includes('激活')) hypotheses.push({ rank: 1, hypothesis: '首次价值路径或激活事件定义存在摩擦', evidence: ['当前指标被标记为激活阶段'], confidence: 'medium', nextCheck: '比较完成关键首次行为与未完成用户的后续留存' })
  if (stage.includes('retention') || stage.includes('留存')) hypotheses.push({ rank: 1, hypothesis: '新增用户质量、核心使用频率或产品价值交付发生变化', evidence: ['当前指标被标记为留存阶段'], confidence: 'medium', nextCheck: '按注册队列和获客渠道查看留存曲线，区分真实流失与自然生命周期结束' })
  if (stage.includes('revenue') || stage.includes('收入') || stage.includes('mrr')) hypotheses.push({ rank: 1, hypothesis: '新增、扩张、收缩、重新激活或流失 MRR 的结构发生变化', evidence: ['当前指标被标记为收入阶段'], confidence: 'medium', nextCheck: '生成 MRR Bridge，并按套餐、渠道和客户类型拆分' })
  if (hypotheses.length === 0) hypotheses.push({ rank: 1, hypothesis: '指标变化可能由分子、分母或样本构成变化导致', evidence: ['未提供足够的漏斗阶段上下文'], confidence: 'low', nextCheck: '先拆分分子、分母、渠道、分群和时间队列' })
  if (options.audit && options.audit.readiness.metrics < 60) hypotheses.push({ rank: hypotheses.length + 1, hypothesis: '指标口径或数据来源不稳定，导致变化不可解释', evidence: [`指标准备度为 ${options.audit.readiness.metrics}/100`], confidence: 'high', nextCheck: '先补齐公式、来源、时间窗口和样本量，再判断业务原因' })
  const dataGaps = ['尚未验证因果关系', '尚未完成渠道、分群和队列拆解']
  if (!options.context?.trim()) dataGaps.push('没有提供业务背景或同期变更记录')
  return {
    generatedAt: new Date().toISOString(),
    metric: options.metric,
    current: options.current,
    previous: options.previous,
    delta,
    deltaRate,
    interpretation: `${options.metric} 从 ${options.previous} 变为 ${options.current}，当前判断为${direction}；这描述了结果，不等于因果结论。`,
    hypotheses: hypotheses.map((item, index) => ({ ...item, rank: index + 1 })),
    dataGaps,
    nextActions: [
      '固定指标定义、时间窗口和来源',
      '按渠道、用户分群和队列拆解变化',
      '将最高优先级假设转成带护栏指标的 HADI 实验',
    ],
  }
}
