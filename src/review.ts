import type { CohortAnalysis, DatasetProfile, EconomicsAnalysis, FunnelAnalysis, GrowthReviewResult } from './types.js'

const eventAliases: Array<{ stage: string; names: string[] }> = [
  { stage: 'Acquisition', names: ['acquired', 'acquisition', 'signup', 'sign_up', 'registered', 'install', 'lead'] },
  { stage: 'Activation', names: ['activated', 'activation', 'onboarding_completed', 'first_value', 'aha'] },
  { stage: 'Retention', names: ['retained', 'retention', 'active', 'login', 'returned'] },
  { stage: 'Referral', names: ['referred', 'referral', 'invited', 'invite_sent'] },
  { stage: 'Revenue', names: ['paid', 'purchase', 'purchased', 'subscribed', 'subscription', 'payment'] },
]

function eventKey(value: string): string {
  return value.toLowerCase().trim().replace(/[^a-z0-9]+/g, '_')
}

export function inferStages(profile: DatasetProfile): Array<{ name: string; event: string }> {
  const values = new Map(profile.distinctValues.events.map((value) => [eventKey(value), value]))
  return eventAliases.flatMap(({ stage, names }) => {
    const event = names.map(eventKey).map((name) => values.get(name)).find(Boolean)
    return event ? [{ name: stage, event }] : []
  })
}

function latestRetention(cohort: CohortAnalysis): number | null {
  const cells = cohort.cohorts.flatMap((item) => item.cells.filter((cell) => cell.period > 0 && cell.retentionRate !== null))
  if (cells.length === 0) return null
  return cells.at(-1)?.retentionRate ?? null
}

export function buildReview(input: {
  goal: string
  profiles: DatasetProfile[]
  funnel?: FunnelAnalysis
  cohort?: CohortAnalysis
  economics?: EconomicsAnalysis
  noteAudit?: GrowthReviewResult['analyses']['noteAudit']
}): GrowthReviewResult {
  const warnings = input.profiles.flatMap((profile) => profile.quality.warnings)
  const bottlenecks: string[] = []
  const hypotheses: string[] = []
  const nextActions: string[] = []
  if (input.funnel?.bottleneck) {
    const bottleneck = input.funnel.bottleneck
    bottlenecks.push(`${bottleneck.name} is the largest observed funnel drop-off (${bottleneck.dropOffFromPrevious ?? 0}%)`)
    hypotheses.push(`Users may not reach the value moment at ${bottleneck.name}; segment this step by channel and inspect the first failed action before changing acquisition spend`)
    nextActions.push(`Instrument the ${bottleneck.name} failure reason and run one focused HADI experiment`)
  }
  const retention = input.cohort ? latestRetention(input.cohort) : null
  if (retention !== null) {
    bottlenecks.push(`Latest observed cohort retention is ${retention}% in the supplied window`)
    hypotheses.push('Retention may be constrained by time-to-value or insufficient repeat use; compare retained and dormant cohorts by plan or acquisition channel')
    nextActions.push('Define a retention guardrail and inspect the next two cohort periods before scaling acquisition')
  }
  const latestEconomics = input.economics?.periods.at(-1)
  if (latestEconomics?.nrr !== null && latestEconomics?.nrr !== undefined && latestEconomics.nrr < 100) {
    bottlenecks.push(`Latest NRR is ${latestEconomics.nrr}%, indicating existing revenue contraction or churn`)
    hypotheses.push('Acquisition growth may be masking expansion, contraction or churn; fix customer health and cancellation reasons before optimizing top-of-funnel volume')
    nextActions.push('Break down churn and contraction by customer segment and validate the MRR movement sign convention')
  }
  if (latestEconomics?.cac !== null && latestEconomics?.cac !== undefined && latestEconomics?.ltv !== null && latestEconomics?.ltv !== undefined && latestEconomics.cac >= latestEconomics.ltv) {
    bottlenecks.push(`Latest CAC is not below LTV (${latestEconomics.cac} vs ${latestEconomics.ltv})`)
    nextActions.push('Pause channel scaling until CAC, gross margin and payback inputs are reconciled')
  }
  if (input.noteAudit && input.noteAudit.topActions.length > 0) nextActions.push(...input.noteAudit.topActions.slice(0, 2))
  if (warnings.length > 0) nextActions.push('Resolve the highest-severity data warnings and rerun the review before making a budget or product decision')
  if (nextActions.length === 0) nextActions.push('Choose the next measurable experiment and record owner, target, guardrails and decision date')
  return {
    generatedAt: new Date().toISOString(),
    goal: input.goal,
    profiles: input.profiles,
    analyses: {
      ...(input.funnel ? { funnel: input.funnel } : {}),
      ...(input.cohort ? { cohort: input.cohort } : {}),
      ...(input.economics ? { economics: input.economics } : {}),
      ...(input.noteAudit ? { noteAudit: input.noteAudit } : {}),
    },
    bottlenecks: [...new Set(bottlenecks)],
    hypotheses: [...new Set(hypotheses)],
    nextActions: [...new Set(nextActions)],
    warnings: [...new Set(warnings)],
  }
}

