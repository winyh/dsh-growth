import { numberValue, stringValue } from './data.js'
import { percentage, safeDivide, round } from './metrics.js'
import type { EconomicsAnalysis, Row } from './types.js'

export interface EconomicsOptions {
  periodField: string
  typeField: string
  amountField: string
  customerField: string
  spendField: string
  currency: string
  grossMargin: number
  beginningMrr?: number
  beginningCustomers?: number
  amountMode?: 'absolute' | 'signed'
  movementSource?: 'movement' | 'snapshot'
}

interface NumericSummary {
  value: number | null
  observed: number
  invalid: number
  missing: number
}

function hasValue(value: unknown): boolean {
  return value !== undefined && value !== null && value !== ''
}

function movementAmount(rows: Row[], typeField: string, amountField: string, type: string, mode: 'absolute' | 'signed'): NumericSummary {
  const matching = rows.filter((row) => stringValue(row, typeField)?.toLowerCase() === type)
  let value = 0
  let observed = 0
  let invalid = 0
  let missing = 0
  for (const row of matching) {
    const raw = row[amountField]
    if (!hasValue(raw)) {
      missing += 1
      continue
    }
    const numeric = numberValue(row, amountField)
    if (numeric === undefined) {
      invalid += 1
      continue
    }
    observed += 1
    value += mode === 'absolute' ? Math.abs(numeric) : numeric
  }
  return { value: matching.length === 0 ? 0 : missing > 0 || invalid > 0 ? null : value, observed, invalid, missing }
}

function numericField(rows: Row[], field: string): NumericSummary {
  let value = 0
  let observed = 0
  let invalid = 0
  let missing = 0
  for (const row of rows) {
    const raw = row[field]
    if (!hasValue(raw)) {
      missing += 1
      continue
    }
    const numeric = numberValue(row, field)
    if (numeric === undefined) {
      invalid += 1
      continue
    }
    observed += 1
    value += Math.abs(numeric)
  }
  return { value: observed === 0 || invalid > 0 ? null : value, observed, invalid, missing }
}

function newCustomerCount(rows: Row[], typeField: string, customerField: string): { count: number; hasIds: boolean } {
  const newRows = rows.filter((row) => stringValue(row, typeField)?.toLowerCase() === 'new')
  const ids = new Set(newRows.map((row) => stringValue(row, customerField)).filter((value): value is string => Boolean(value)))
  return { count: ids.size > 0 ? ids.size : newRows.length, hasIds: ids.size > 0 }
}

function snapshotValue(rows: Row[], amountField: string): number | undefined {
  return rows.map((row) => numberValue(row, 'ending_mrr') ?? numberValue(row, amountField)).find((value): value is number => value !== undefined)
}

export function analyzeEconomics(source: string, rows: Row[], options: EconomicsOptions): EconomicsAnalysis {
  const warnings: string[] = []
  const amountMode = options.amountMode ?? 'absolute'
  const movementSource = options.movementSource ?? 'movement'
  const periods = Array.from(new Set(rows.map((row) => stringValue(row, options.periodField)).filter((item): item is string => Boolean(item)))).sort()
  if (periods.length === 0) warnings.push(`No period values found in '${options.periodField}'`)
  const knownMovementTypes = new Set(['new', 'expansion', 'reactivation', 'contraction', 'churn', 'churned'])
  const movementTypeValues = rows.map((row) => stringValue(row, options.typeField)?.toLowerCase()).filter((value): value is string => Boolean(value))
  const unknownMovementTypes = [...new Set(movementTypeValues.filter((value) => !knownMovementTypes.has(value)))]
  if (movementSource === 'movement' && unknownMovementTypes.length > 0) warnings.push(`Unrecognized movement type(s) were ignored: ${unknownMovementTypes.join(', ')}; map them to new, expansion, reactivation, contraction, churn or churned before using the bridge`)
  const signRiskRows = rows.filter((row) => ['contraction', 'churn', 'churned'].includes(stringValue(row, options.typeField)?.toLowerCase() ?? '') && (numberValue(row, options.amountField) ?? 0) !== 0)
  const negativeRisk = signRiskRows.filter((row) => (numberValue(row, options.amountField) ?? 0) < 0).length
  const positiveRisk = signRiskRows.filter((row) => (numberValue(row, options.amountField) ?? 0) > 0).length
  if (amountMode === 'absolute' && negativeRisk > 0) warnings.push(`${negativeRisk} contraction/churn rows are negative; absolute mode converts them to magnitudes before subtracting`)
  if (amountMode === 'signed' && positiveRisk > 0) warnings.push(`${positiveRisk} contraction/churn rows are positive in signed mode; verify that signed inputs really use negative values`)
  if (movementSource === 'snapshot') warnings.push('snapshot mode reads ending MRR from ending_mrr or amount and does not infer movement components from snapshots')
  const output: EconomicsAnalysis['periods'] = []
  periods.forEach((period, index) => {
    const currentRows = rows.filter((row) => stringValue(row, options.periodField) === period)
    const beginningMrr: number | null = index === 0 ? options.beginningMrr ?? null : output[index - 1]?.endingMrr ?? null
    const newAmount = movementSource === 'snapshot' ? { value: 0, observed: 0, invalid: 0, missing: 0 } : movementAmount(currentRows, options.typeField, options.amountField, 'new', amountMode)
    const expansionAmount = movementSource === 'snapshot' ? { value: 0, observed: 0, invalid: 0, missing: 0 } : movementAmount(currentRows, options.typeField, options.amountField, 'expansion', amountMode)
    const reactivationAmount = movementSource === 'snapshot' ? { value: 0, observed: 0, invalid: 0, missing: 0 } : movementAmount(currentRows, options.typeField, options.amountField, 'reactivation', amountMode)
    const contractionAmount = movementSource === 'snapshot' ? { value: 0, observed: 0, invalid: 0, missing: 0 } : movementAmount(currentRows, options.typeField, options.amountField, 'contraction', amountMode)
    const churnAmount = movementSource === 'snapshot' ? { value: 0, observed: 0, invalid: 0, missing: 0 } : movementAmount(currentRows, options.typeField, options.amountField, 'churn', amountMode)
    const churnedAmount = movementSource === 'snapshot' ? { value: 0, observed: 0, invalid: 0, missing: 0 } : movementAmount(currentRows, options.typeField, options.amountField, 'churned', amountMode)
    const amountSummaries = [newAmount, expansionAmount, reactivationAmount, contractionAmount, churnAmount, churnedAmount]
    const amountIssues = amountSummaries.reduce((sum, item) => ({ missing: sum.missing + item.missing, invalid: sum.invalid + item.invalid }), { missing: 0, invalid: 0 })
    const newMrr = newAmount.value
    const expansionMrr = expansionAmount.value
    const reactivationMrr = reactivationAmount.value
    const contractionMrr = contractionAmount.value
    const churnedMrr = churnAmount.value === null || churnedAmount.value === null ? null : churnAmount.value + churnedAmount.value
    const explicitEnding = movementSource === 'snapshot' ? snapshotValue(currentRows, options.amountField) : currentRows.map((row) => numberValue(row, 'ending_mrr')).find((value): value is number => value !== undefined)
    const movementDelta = newMrr !== null && expansionMrr !== null && reactivationMrr !== null && contractionMrr !== null && churnedMrr !== null
      ? amountMode === 'signed'
        ? newMrr + expansionMrr + reactivationMrr + contractionMrr + churnedMrr
        : newMrr + expansionMrr + reactivationMrr - contractionMrr - churnedMrr
      : null
    const endingMrr = explicitEnding ?? (beginningMrr === null || movementDelta === null ? null : movementSource === 'snapshot' ? null : beginningMrr + movementDelta)
    const activeCustomers = currentRows.map((row) => numberValue(row, 'active_customers')).find((value): value is number => value !== undefined) ?? null
    const spendSummary = numericField(currentRows, options.spendField)
    const customers = newCustomerCount(currentRows, options.typeField, options.customerField)
    const newCustomers = customers.count
    const arpa = activeCustomers !== null && activeCustomers > 0 && endingMrr !== null ? endingMrr / activeCustomers : null
    const churnCount = currentRows.filter((row) => ['churn', 'churned'].includes(stringValue(row, options.typeField)?.toLowerCase() ?? '')).length
    const beginningCustomers = index === 0 ? options.beginningCustomers ?? null : output[index - 1]?.activeCustomers ?? null
    const logoChurn = beginningCustomers === null ? null : safeDivide(churnCount, beginningCustomers)
    const revenueChurn = movementSource === 'snapshot' || churnedMrr === null || beginningMrr === null ? null : safeDivide(amountMode === 'signed' ? -churnedMrr : churnedMrr, beginningMrr)
    const nrrBase = beginningMrr !== null && movementSource !== 'snapshot' && expansionMrr !== null && reactivationMrr !== null && contractionMrr !== null && churnedMrr !== null
      ? amountMode === 'signed'
        ? beginningMrr + expansionMrr + reactivationMrr + contractionMrr + churnedMrr
        : beginningMrr + expansionMrr + reactivationMrr - contractionMrr - churnedMrr
      : null
    const nrr = nrrBase === null ? null : safeDivide(nrrBase, beginningMrr ?? 0)
    const cac = newCustomers > 0 && spendSummary.value !== null ? spendSummary.value / newCustomers : null
    const ltv = arpa !== null && options.grossMargin > 0 && revenueChurn !== null && revenueChurn > 0 ? arpa * options.grossMargin / revenueChurn : null
    const paybackMonths = cac !== null && arpa !== null && arpa > 0 && options.grossMargin > 0 ? cac / (arpa * options.grossMargin) : null
    if (beginningMrr === null) warnings.push(`Missing beginning MRR for ${period}; MRR growth and NRR are partial`)
    if (amountIssues.missing > 0) warnings.push(`${amountIssues.missing} MRR movement row(s) in ${period} have no amount; affected bridge components are unavailable rather than treated as zero`)
    if (amountIssues.invalid > 0) warnings.push(`${amountIssues.invalid} MRR movement row(s) in ${period} have a non-numeric amount; affected bridge components are unavailable`)
    if (movementSource === 'snapshot' && explicitEnding === undefined) warnings.push(`No ending MRR snapshot found for ${period}; snapshot metrics are unavailable`)
    if (activeCustomers === null) warnings.push(`No active_customers value for ${period}; ARPA and logo churn are unavailable`)
    if (churnCount > 0 && beginningCustomers === null) warnings.push(`No beginning customer count for ${period}; logo churn is unavailable`)
    if (newCustomers > 0 && !customers.hasIds) warnings.push(`No customer IDs found for new rows in ${period}; CAC uses new movement rows as a proxy for new customers`)
    if (newCustomers > 0 && spendSummary.value === null) warnings.push(`No usable spend value for ${period}; CAC and payback are unavailable`)
    if (spendSummary.invalid > 0) warnings.push(`${spendSummary.invalid} spend value(s) in ${period} are non-numeric; CAC is unavailable for this period`)
    output.push({
      period,
      beginningMrr: round(beginningMrr, 2),
      newMrr: round(newMrr, 2),
      expansionMrr: round(expansionMrr, 2),
      reactivationMrr: round(reactivationMrr, 2),
      contractionMrr: round(contractionMrr, 2),
      churnedMrr: round(churnedMrr, 2),
      endingMrr: round(endingMrr, 2),
      mrrGrowthRate: percentage(beginningMrr === null || endingMrr === null ? null : safeDivide(endingMrr - beginningMrr, beginningMrr)),
      activeCustomers,
      arpa: round(arpa, 2),
      logoChurnRate: percentage(logoChurn),
      revenueChurnRate: percentage(revenueChurn),
      nrr: percentage(nrr),
      cac: round(cac, 2),
      ltv: round(ltv, 2),
      paybackMonths: round(paybackMonths, 2),
    })
  })
  const endingMrr = output.at(-1)?.endingMrr ?? null
  return {
    generatedAt: new Date().toISOString(),
    source,
    currency: options.currency,
    amountMode,
    movementSource,
    periods: output,
    totals: {
      endingMrr,
      arr: endingMrr === null ? null : endingMrr * 12,
      totalSpend: numericField(rows, options.spendField).value,
      totalNewCustomers: newCustomerCount(rows, options.typeField, options.customerField).count,
    },
    warnings: [...new Set(warnings)],
  }
}
