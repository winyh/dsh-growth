import { describe, expect, it } from 'vitest'
import { buildMetricContractReview, consumeGrowthHandoff } from '../src/contracts.js'

describe('growth contracts', () => {
  it('consumes a product growth handoff with evidence boundaries', () => {
    const result = consumeGrowthHandoff({ artifactType: 'growth-handoff', productName: 'Demo', productOutcome: '完成核心任务', primaryMetric: 'activation', evidence: ['5/6 completed'], guardrails: ['error rate'], openQuestions: [] })
    expect(result.status).toBe('ready')
    expect(result.schemaVersion).toBe('1.0')
  })

  it('requires event and observation window in metric definitions', () => {
    const result = buildMetricContractReview({ metrics: [{ name: 'Activation', event: 'activated', window: '7d' }, { name: 'Missing' }], timezone: 'Asia/Shanghai', currency: 'CNY' })
    expect(result.metrics[0]?.status).toBe('ready')
    expect(result.metrics[1]?.status).toBe('partial')
  })
})
