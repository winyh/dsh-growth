import { describe, expect, it } from 'vitest'
import { buildMetricContractReview, consumeGrowthHandoff } from '../src/contracts.js'

describe('growth contracts', () => {
  it('consumes a product growth handoff with evidence boundaries', () => {
    const result = consumeGrowthHandoff({ artifactType: 'growth-handoff', handoffFrom: 'dsh-product', handoffTo: 'dsh-growth', source: 'product.md', productName: 'Demo', productOutcome: '完成核心任务', primaryMetric: 'activation', evidence: ['5/6 completed'], guardrails: ['error rate'], openQuestions: [] })
    expect(result.status).toBe('ready')
    expect(result.schemaVersion).toBe('1.0')
  })

  it('requires event and observation window in metric definitions', () => {
    const result = buildMetricContractReview({ metrics: [{ name: 'Activation', event: 'activated', window: '7d' }, { name: 'Missing' }], timezone: 'Asia/Shanghai', currency: 'CNY' })
    expect(result.metrics[0]?.status).toBe('ready')
    expect(result.metrics[1]?.status).toBe('partial')
  })
  it('rejects misrouting and retains missing guardrails or incomplete upstream state', () => {
    const input = { artifactType: 'growth-handoff', handoffFrom: 'dsh-product', handoffTo: 'dsh-growth',
      productName: 'Demo', productOutcome: 'Export', source: 'product.md', primaryMetric: 'activation', evidence: ['demo'], guardrails: ['errors'] }
    expect(consumeGrowthHandoff({ ...input, handoffTo: 'dsh-sales' }).status).toBe('blocked')
    expect(consumeGrowthHandoff({ ...input, guardrails: [] }).status).toBe('partial')
    expect(consumeGrowthHandoff({ ...input, status: 'partial' }).status).toBe('partial')
  })
})
