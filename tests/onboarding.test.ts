import { describe, expect, it } from 'vitest'
import { auditGrowthNote } from '../src/context.js'
import { buildGrowthOnboarding, type OnboardingNote } from '../src/onboarding.js'
import { parseNote } from '../src/markdown.js'
import { profileDataset } from '../src/quality.js'
import type { Row } from '../src/types.js'

describe('growth onboarding readiness', () => {
  it('combines strategy evidence, dataset readiness and method coverage', () => {
    const note = parseNote('growth.md', `# Growth project

JTBD: team leads need to reach the first value quickly; 痛点是 onboarding 太慢，期望进步是更快完成 setup，当前替代方案是 spreadsheet。
ICP and target user are product-led SaaS teams.
PMF Survey: very disappointed signal with https://example.com/source
North Star Metric: weekly activated teams; drivers, baseline, target and period are defined.
AARRR: Acquisition, Activation, Retention, Referral, Revenue.

| metric | definition | source | sample | period |
| --- | --- | --- | --- | --- |
| activation | activated / acquired | events.csv | 1000 | week |

Hypothesis: If onboarding is shorter, activation will increase.
HADI experiment with primary metric, guardrail metric, owner and success criteria.
Growth Loop and RICE are recorded.

type: growth-project
status: active
updated: 2026-08-16
owner: growth
target: activation
source: events.csv`)
    const audit = auditGrowthNote(note)
    const onboardingNote: OnboardingNote = { note, audit, missingMetadata: [] }
    const rows: Row[] = [
      { user_id: 'u1', event: 'signup', timestamp: '2026-08-01T00:00:00Z' },
      { user_id: 'u1', event: 'activated', timestamp: '2026-08-01T01:00:00Z' },
      { user_id: 'u1', event: 'active', timestamp: '2026-08-08T01:00:00Z' },
      { user_id: 'u2', event: 'signup', timestamp: 'not-a-date' },
    ]
    const profile = profileDataset('events.csv', rows)
    const result = buildGrowthOnboarding({ root: '.', notes: [onboardingNote], profiles: [profile], datasetWarnings: [], scanErrors: [] })

    expect(result.sources.growthNotes).toBe(1)
    expect(result.sources.eventDatasets).toEqual(['events.csv'])
    expect(result.dimensions.find((item) => item.id === 'jtbd')?.status).toBe('ready')
    expect(result.dimensions.find((item) => item.id === 'data')?.status).toBe('partial')
    expect(result.methods.find((item) => item.id === 'growth-loops')?.projectStatus).toBe('ready')
    expect(result.methods.find((item) => item.id === 'causal-inference')?.projectStatus).toBe('not-applicable')
    expect(result.topActions.length).toBeLessThanOrEqual(2)
    expect(result).not.toHaveProperty('rows')
  })

  it('blocks clearly when neither strategy notes nor datasets exist', () => {
    const result = buildGrowthOnboarding({ root: '.', notes: [], profiles: [], datasetWarnings: [], scanErrors: [] })

    expect(result.overallStatus).toBe('blocked')
    expect(result.overallScore).toBe(0)
    expect(result.topActions.length).toBe(2)
    expect(result.warnings.some((warning) => warning.includes('No growth Markdown note'))).toBe(true)
    expect(result.questions.length).toBeGreaterThan(0)
  })
})
