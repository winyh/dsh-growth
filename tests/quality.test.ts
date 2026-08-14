import { describe, expect, it } from 'vitest'
import { profileDataset } from '../src/quality.js'
import { inferStages, buildReview, selectReviewSources } from '../src/review.js'
import type { Row } from '../src/types.js'

describe('onboarding quality and review', () => {
  it('profiles fields and reports data risks without returning raw rows', () => {
    const rows: Row[] = [
      { user_id: 'u1', event: 'signup', timestamp: '2026-01-01T00:00:00Z', channel: 'content' },
      { user_id: 'u1', event: 'signup', timestamp: 'not-a-date', channel: 'content' },
      { user_id: 'u2', event: 'activated', timestamp: '2026-01-02T00:00:00Z', channel: 'ads' },
    ]
    const profile = profileDataset('events.csv', rows)
    expect(profile.selectedFields.userField).toBe('user_id')
    expect(profile.selectedFields.eventField).toBe('event')
    expect(profile.selectedFields.timeField).toBe('timestamp')
    expect(profile.quality.invalidDateRows).toBe(1)
    expect(profile.quality.duplicateRows).toBe(0)
    expect(profile).not.toHaveProperty('sampleRows')
  })

  it('infers only recognizable funnel stages and gives a next action', () => {
    const profile = profileDataset('events.json', [
      { user_id: 'u1', event: 'signup', timestamp: '2026-01-01' },
      { user_id: 'u1', event: 'activated', timestamp: '2026-01-02' },
      { user_id: 'u1', event: 'active', timestamp: '2026-01-03' },
    ])
    const stages = inferStages(profile)
    expect(stages.map((stage) => stage.name)).toEqual(['Acquisition', 'Activation', 'Retention'])
    const review = buildReview({ goal: 'improve activation', profiles: [profile] })
    expect(review.nextActions.length).toBeGreaterThan(0)
    expect(review.goal).toBe('improve activation')
  })

  it('recognizes common Chinese event names', () => {
    const profile = profileDataset('events.csv', [
      { user_id: 'u1', event: '注册', timestamp: '2026-01-01' },
      { user_id: 'u1', event: '激活', timestamp: '2026-01-02' },
      { user_id: 'u1', event: '活跃', timestamp: '2026-01-03' },
      { user_id: 'u1', event: '付费', timestamp: '2026-01-04' },
    ])
    expect(inferStages(profile).map((stage) => stage.name)).toEqual(['Acquisition', 'Activation', 'Retention', 'Revenue'])
  })

  it('selects the most analysis-ready event and economics sources', () => {
    const eventProfile = profileDataset('events.csv', [
      { user_id: 'u1', event: 'signup', timestamp: '2026-01-01' },
      { user_id: 'u1', event: 'activated', timestamp: '2026-01-02' },
    ])
    const economicsProfile = profileDataset('mrr.csv', [
      { period: '2026-01', type: 'new', amount: 100 },
    ])
    const selection = selectReviewSources([eventProfile, economicsProfile])
    expect(selection.eventPath).toBe('events.csv')
    expect(selection.economicsPath).toBe('mrr.csv')
  })
})
