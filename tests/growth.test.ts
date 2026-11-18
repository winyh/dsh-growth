import { describe, expect, it } from 'vitest'
import { auditGrowthNote } from '../src/context.js'
import { analyzeEconomics } from '../src/economics.js'
import { createExperiment } from '../src/experiments.js'
import { analyzeFunnel } from '../src/funnel.js'
import { analyzeCohorts } from '../src/cohort.js'
import { parseNote } from '../src/markdown.js'
import { renderReport } from '../src/reports.js'
import type { Row } from '../src/types.js'

const events: Row[] = [
  { user_id: 'u1', event: 'acquired', timestamp: '2026-01-01T00:00:00Z', channel: 'content' },
  { user_id: 'u1', event: 'activated', timestamp: '2026-01-01T01:00:00Z', channel: 'content' },
  { user_id: 'u1', event: 'active', timestamp: '2026-01-02T00:00:00Z', channel: 'content' },
  { user_id: 'u2', event: 'acquired', timestamp: '2026-01-01T00:00:00Z', channel: 'ads' },
  { user_id: 'u2', event: 'activated', timestamp: '2026-01-01T02:00:00Z', channel: 'ads' },
]

describe('growth analysis', () => {
  it('finds the largest AARRR funnel drop-off', () => {
    const result = analyzeFunnel('events.json', events, {
      stages: [
        { name: 'Acquisition', event: 'acquired' },
        { name: 'Activation', event: 'activated' },
        { name: 'Retention', event: 'active' },
      ],
      userField: 'user_id',
      eventField: 'event',
      channelField: 'channel',
    })
    expect(result.userCount).toBe(2)
    expect(result.stages[1]?.conversionFromPrevious).toBe(100)
    expect(result.stages[2]?.conversionFromPrevious).toBe(50)
    expect(result.bottleneck?.name).toBe('Retention')
    expect(result.byChannel.content).toBeDefined()
  })

  it('supports a strict ordered funnel and conversion window', () => {
    const result = analyzeFunnel('ordered.json', [
      { user_id: 'u1', event: 'acquired', timestamp: '2026-01-01T00:00:00Z', channel: 'content' },
      { user_id: 'u1', event: 'activated', timestamp: '2026-01-02T00:00:00Z', channel: 'content' },
      { user_id: 'u2', event: 'activated', timestamp: '2026-01-01T00:00:00Z', channel: 'ads' },
      { user_id: 'u2', event: 'acquired', timestamp: '2026-01-02T00:00:00Z', channel: 'ads' },
    ], {
      stages: [
        { name: 'Acquisition', event: 'acquired' },
        { name: 'Activation', event: 'activated' },
      ],
      userField: 'user_id',
      eventField: 'event',
      timeField: 'timestamp',
      sequenceMode: 'ordered',
      conversionWindowDays: 3,
      attribution: 'entry-touch',
    })
    expect(result.sequenceMode).toBe('ordered')
    expect(result.stages[0]?.users).toBe(2)
    expect(result.stages[1]?.users).toBe(1)
  })

  it('preserves the ordered funnel, window and channel attribution across export orders', () => {
    const rows = ['visit', 'signup', 'active', 'pay'].map((event, i) => ({
      user_id: 'u', event, timestamp: '2026-01-0' + (i + 1), channel: event,
    }))
    for (const [attribution, channel] of [['first-touch', 'visit'], ['entry-touch', 'signup'], ['last-touch', 'pay']] as const) {
      for (const input of [rows, rows.toReversed(), [rows[2]!, rows[0]!, rows[3]!, rows[1]!]]) {
        const result = analyzeFunnel('events', input, {
          stages: ['signup', 'active', 'pay'].map(event => ({ name: event, event })),
          userField: 'user_id', eventField: 'event', sequenceMode: 'ordered',
          conversionWindowDays: 1, channelField: 'channel', attribution,
        })
        expect(result.stages.map(stage => stage.users)).toEqual([1, 1, 0])
        expect(result.byChannel[channel]).toEqual(result.stages)
      }
    }
  })

  it('builds a daily retention cohort', () => {
    const result = analyzeCohorts('events.json', events, {
      cohortEvent: 'acquired',
      retentionEvent: 'active',
      userField: 'user_id',
      eventField: 'event',
      timeField: 'timestamp',
      interval: 'day',
      observedThrough: '2026-01-02',
      maxPeriods: 3,
    })
    expect(result.cohorts).toHaveLength(1)
    expect(result.cohorts[0]?.cells[0]?.retentionRate).toBe(0)
    expect(result.cohorts[0]?.cells[1]?.retainedUsers).toBe(1)
  })

  it('only reports zero after a whole retention window has been observed', () => {
    const options = { cohortEvent: 'signup', retentionEvent: 'active', userField: 'u', eventField: 'e',
      timeField: 't', interval: 'day' as const, maxPeriods: 3, timezone: 'Asia/Shanghai' }
    const rows = [{ u: '1', e: 'signup', t: '2026-01-31T16:01:00Z' }]
    const cells = (interval: 'day' | 'week' | 'month', observedThrough?: string) =>
      analyzeCohorts('export', rows, { ...options, interval, observedThrough }).cohorts[0]!.cells
    expect(cells('day').map(cell => cell.retentionRate)).toEqual([null, null, null])
    expect(cells('day', '2026-02-02').map(cell => cell.retainedUsers)).toEqual([0, 0, null])
    expect(cells('week', '2026-02-06')[0]?.observed).toBe(false)
    expect(cells('week', '2026-02-07')[0]?.retentionRate).toBe(0)
    expect(cells('month', '2026-02-28').map(cell => cell.retentionRate)).toEqual([0, null, null])
    expect(() => cells('day', '2026-02-30')).toThrow('observedThrough')
  })

  it('identifies users who return after an inactive period', () => {
    const result = analyzeCohorts('events.json', [
      { user_id: 'u1', event: 'acquired', timestamp: '2026-01-01T00:00:00Z' },
      { user_id: 'u1', event: 'active', timestamp: '2026-01-02T00:00:00Z' },
      { user_id: 'u1', event: 'active', timestamp: '2026-01-04T00:00:00Z' },
    ], {
      cohortEvent: 'acquired',
      retentionEvent: 'active',
      userField: 'user_id',
      eventField: 'event',
      timeField: 'timestamp',
      interval: 'day',
      maxPeriods: 5,
    })
    expect(result.lifecycle.resurrected).toBe(1)
    expect(result.lifecycle.retained).toBe(0)
  })

  it('calculates an MRR bridge without inventing beginning MRR', () => {
    const rows: Row[] = [
      { period: '2026-01', type: 'new', amount: 100, customer_id: 'u1', active_customers: 1, spend: 200 },
      { period: '2026-01', type: 'expansion', amount: 50, customer_id: 'u1' },
      { period: '2026-02', type: 'churned', amount: 50, customer_id: 'u1', active_customers: 0 },
    ]
    const result = analyzeEconomics('mrr.json', rows, {
      periodField: 'period',
      typeField: 'type',
      amountField: 'amount',
      customerField: 'customer_id',
      spendField: 'spend',
      currency: 'CNY',
      grossMargin: 0.8,
      beginningMrr: 500,
    })
    expect(result.periods[0]?.endingMrr).toBe(650)
    expect(result.periods[1]?.endingMrr).toBe(600)
    expect(result.periods[0]?.cac).toBe(200)
    expect(result.totals.arr).toBe(7200)
  })

  it('keeps signed MRR movements signed and warns on positive churn', () => {
    const result = analyzeEconomics('signed.json', [
      { period: '2026-01', type: 'new', amount: 100, customer_id: 'u1', active_customers: 1 },
      { period: '2026-02', type: 'churned', amount: -20, customer_id: 'u1', active_customers: 0 },
    ], {
      periodField: 'period',
      typeField: 'type',
      amountField: 'amount',
      customerField: 'customer_id',
      spendField: 'spend',
      currency: 'CNY',
      grossMargin: 0.8,
      amountMode: 'signed',
      beginningMrr: 0,
    })
    expect(result.amountMode).toBe('signed')
    expect(result.periods[1]?.churnedMrr).toBe(-20)
    expect(result.periods[1]?.endingMrr).toBe(80)
  })

  it('does not convert missing MRR amounts or spend into zero', () => {
    const result = analyzeEconomics('incomplete.json', [
      { period: '2026-01', type: 'new', amount: 100, customer_id: 'u1', active_customers: 1, spend: 200 },
      { period: '2026-01', type: 'churned', customer_id: 'u1' },
    ], {
      periodField: 'period',
      typeField: 'type',
      amountField: 'amount',
      customerField: 'customer_id',
      spendField: 'spend',
      currency: 'CNY',
      grossMargin: 0.8,
      beginningMrr: 100,
    })
    expect(result.periods[0]?.churnedMrr).toBeNull()
    expect(result.periods[0]?.endingMrr).toBeNull()
    expect(result.periods[0]?.nrr).toBeNull()
    expect(result.periods[0]?.cac).toBe(200)
    expect(result.warnings.some((warning) => warning.includes('no amount'))).toBe(true)
  })

  it('leaves CAC unavailable when spend is absent', () => {
    const result = analyzeEconomics('no-spend.json', [
      { period: '2026-01', type: 'new', amount: 100, customer_id: 'u1', active_customers: 1 },
    ], {
      periodField: 'period',
      typeField: 'type',
      amountField: 'amount',
      customerField: 'customer_id',
      spendField: 'spend',
      currency: 'CNY',
      grossMargin: 0.8,
      beginningMrr: 0,
    })
    expect(result.periods[0]?.cac).toBeNull()
    expect(result.totals.totalSpend).toBeNull()
    expect(result.warnings.some((warning) => warning.includes('No usable spend'))).toBe(true)
  })

  it('returns explainable audit gaps and an experiment card', () => {
    const audit = auditGrowthNote(parseNote('weak.md', '# Growth\n\nA short idea.'))
    expect(audit.readiness.overall).toBeLessThan(50)
    expect(audit.findings.length).toBeGreaterThan(0)
    const experiment = createExperiment({
      title: 'Shorten onboarding',
      problem: 'Activation is low',
      hypothesis: 'If we remove one step, activation will increase',
      stage: 'activation',
      targetMetric: 'activation_rate',
      guardrails: ['day_7_retention'],
      method: 'rice',
      reach: 1000,
      impact: 2,
      confidence: 0.8,
      effort: 1,
    })
    expect(experiment.priority.score).toBe(1600)
    expect(experiment.markdown).toContain('## HADI 复盘')
  })

  it('renders a report with explicit caveats', () => {
    const report = renderReport({
      title: 'WBR',
      reportType: 'wbr',
      period: '2026-W01',
      summary: 'Retention improved.',
      metrics: [{ name: 'MRR', current: '650', previous: '500', delta: '+30%', source: 'mrr.json' }],
      findings: ['Retention is the bottleneck'],
      experiments: ['Shorten onboarding'],
      nextActions: ['Run the experiment'],
      caveats: ['Small sample'],
    })
    expect(report).toContain('| MRR | 650 | 500 | +30% | mrr.json |')
    expect(report).toContain('缺失数据未按零处理')
  })
})
