import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { attachArtifactMetadata } from '../src/artifacts.js'
import { reviewGrowthAttribution } from '../src/attribution.js'
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-22T12:00:00Z')) })
afterEach(() => vi.useRealTimers())
function plan() { return attachArtifactMetadata({ artifactType: 'geo-growth-measurement-plan', generatedAt: '2026-09-01',
  handoffFrom: 'dsh-geo', handoffTo: 'dsh-growth', contentId: 'page-1', channel: 'organic', targetMetric: 'activation',
  source: 'brief.md', publishAt: '2026-09-01', baselineWindow: '2026-08-01/2026-08-31' }, { staleAfterDays: 90 }) }
const row = { contentId: 'page-1', channel: 'organic', metric: 'activation', baseline: 12, value: 8, unit: 'users',
  baselineWindow: '2026-08-01/2026-08-31', window: '2026-09-01/2026-09-21', source: 'events.csv' }
it('preserves negative outcomes and binds observations to the exact plan', () => {
  const result = reviewGrowthAttribution(plan(), [row])
  expect(result.status).toBe('measured')
  expect(result.results[0]?.deltas[0]?.delta).toBe(-4)
  expect(result.causality).toBe('not-established')
})
it('does not count missing plans or observations as success', () => {
  expect(reviewGrowthAttribution([], []).status).toBe('partial')
  expect(reviewGrowthAttribution(plan(), []).results[0]?.status).toBe('unmeasured')
  expect(reviewGrowthAttribution({ ok: false, data: plan() }, [row]).status).not.toBe('measured')
})
it('rejects bad windows, missing units/sources, nonfinite numbers and duplicate observations', () => {
  for (const changes of [{ source: '' }, { unit: '' }, { value: Infinity }, { baseline: '12' },
    { window: '2026-08-01/2026-09-21' }, { window: '2026-09-01/2026-12-31' }, { baselineUnit: 'percent' }, { baselineWindow: 'different' }]) {
    expect(reviewGrowthAttribution(plan(), [{ ...row, ...changes }]).status).toBe('partial')
  }
  expect(reviewGrowthAttribution(plan(), [row, row]).status).toBe('partial')
  expect(reviewGrowthAttribution({ ...plan(), targetMetric: 'revenue' }, [row]).status).toBe('blocked')
})
