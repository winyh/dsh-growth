import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createExperiment } from '../src/experiments.js'
import { assessExperiment } from '../src/experiment-assessment.js'

const primary = { metric: 'activation', direction: 'at-least', threshold: 3, unit: 'pp', minPerGroup: 100 }
const guard = { ...primary, metric: 'refund', direction: 'at-most', threshold: 0.1 }
const criteria = { start: '2027-01-02', end: '2027-03-02', primary, guardrails: [guard] }
const design = { title: 'Onboarding', problem: 'Low activation', hypothesis: 'Fewer steps help', stage: 'activation' as const,
  targetMetric: 'activation', guardrails: ['refund'] }
function register() {
  return JSON.parse(JSON.stringify(createExperiment({ ...design, criteriaJson: JSON.stringify(criteria) })))
}
const mainRow = { metric: 'activation', control: 20, treatment: 23, unit: 'pp', controlN: 100, treatmentN: 100, source: 'events.csv' }
const guardRow = { ...mainRow, metric: 'refund', control: 4.1, treatment: 4.2 }
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2027-01-01T12:00:00Z')) })
afterEach(() => vi.useRealTimers())

describe('preregistered experiment assessment', () => {
  it('preserves draft cards and refuses retrospective or ambiguous registration', () => {
    expect(createExperiment(design)).not.toHaveProperty('criteria')
    expect(() => assessExperiment(createExperiment(design), {})).toThrow('original')
    for (const changes of [{ start: criteria.end }, { start: '2027-02-30' }, { start: '2026-12-01' }, { guardrails: [] },
      { primary: { ...primary, metric: 'refund' } }, { primary: { ...primary, direction: 'higher' } },
      { guardrails: [guard, guard] }, { guardrails: [{ ...guard, metric: 'changed' }] },
      { primary: { ...primary, minPerGroup: 0 } }, { primary: { ...primary, threshold: '3' } }]) {
      expect(() => createExperiment({ ...design, criteriaJson: JSON.stringify({ ...criteria, ...changes }) })).toThrow()
    }
  })

  it('waits for the exact end and grades inclusive decimal limits for a long experiment', () => {
    const plan = register()
    const batch = { start: criteria.start, end: criteria.end, planHash: plan.contentHash, rows: [mainRow, guardRow] }
    vi.setSystemTime(Date.parse(criteria.end) - 1)
    expect(assessExperiment(plan, batch).metrics.map(row => row.status)).toEqual(['pending', 'pending'])
    vi.setSystemTime(Date.parse(criteria.end))
    const result = assessExperiment({ ok: true, data: plan }, batch)
    expect(result.status).toBe('met')
    expect(result.metrics[1]).toMatchObject({ status: 'met', delta: 0.1, source: 'events.csv' })
    expect(assessExperiment(plan, { ...batch, rows: [{ ...mainRow, treatment: 22 }, guardRow] }).status).toBe('missed')
  })

  it('reports met, breached and insufficient separately without concealing a known breach', () => {
    const plan = createExperiment({ ...design, guardrails: [], criteriaJson: JSON.stringify({
      ...criteria, guardrails: [guard, { ...guard, metric: 'support' }],
    }) })
    const saved = JSON.parse(JSON.stringify(plan))
    vi.setSystemTime(Date.parse(criteria.end))
    const result = assessExperiment(saved, { planHash: saved.contentHash, start: criteria.start, end: criteria.end,
      rows: [mainRow, { ...guardRow, treatment: 4.3 }] })
    expect(result.status).toBe('breached')
    expect(result.metrics.map(row => row.status)).toEqual(['met', 'breached', 'insufficient-data'])
  })

  it('distinguishes absent, duplicate, partial-window, low-sample and mismatched evidence from zero', () => {
    const plan = register()
    vi.setSystemTime(Date.parse(criteria.end))
    const batch = { start: criteria.start, end: criteria.end, planHash: plan.contentHash }
    for (const rows of [[mainRow], [mainRow, guardRow, guardRow], [mainRow, { ...guardRow, treatmentN: 99 }],
      [mainRow, { ...guardRow, control: null }], [mainRow, { ...guardRow, unit: '%' }], [mainRow, { ...guardRow, source: ' ' }],
      [mainRow, { ...guardRow, treatment: 101 }]]) {
      const result = assessExperiment(plan, { ...batch, rows })
      expect(result.status).toBe('insufficient-data')
      expect(result.metrics[0]?.status).toBe('met')
      expect(result.metrics[1]).toHaveProperty('reason')
    }
    for (const changes of [{ planHash: 'wrong' }, { start: '2027-01-15' }, { end: '2027-02-28' }]) {
      expect(assessExperiment(plan, { ...batch, ...changes, rows: [mainRow, guardRow] }).status).toBe('insufficient-data')
    }
    expect(assessExperiment(plan, { ...batch, rows: [mainRow, { ...guardRow, control: 0, treatment: 0 }] }).status).toBe('met')
    expect(() => assessExperiment({ ...plan, criteria: { ...plan.criteria, end: '2027-02-28' } }, batch)).toThrow('original')
    expect(() => assessExperiment({ ok: false, data: plan }, batch)).toThrow('unsuccessful')
  })
})
