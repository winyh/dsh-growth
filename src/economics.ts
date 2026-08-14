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
function amount(rows: Row[], typeField: string, amountField: string, type: string, mode: 'absolute' | 'signed'): number {
  return rows
    .filter((row) => stringValue(row, typeField)?.toLowerCase() === type)
    .reduce((sum, row) => {
      const value = numberValue(row, amountField) ?? 0
      return sum + (mode === 'absolute' ? Math.abs(value) : value)
    }, 0)
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
    const newMrr = movementSource === 'snapshot' ? 0 : amount(currentRows, options.typeField, options.amountField, 'new', amountMode)
    const expansionMrr = movementSource === 'snapshot' ? 0 : amount(currentRows, options.typeField, options.amountField, 'expansion', amountMode)
    const reactivationMrr = movementSource === 'snapshot' ? 0 : amount(currentRows, options.typeField, options.amountField, 'reactivation', amountMode)
    const contractionMrr = movementSource === 'snapshot' ? 0 : amount(currentRows, options.typeField, options.amountField, 'contraction', amountMode)
    const churnedMrr = movementSource === 'snapshot' ? 0 : amount(currentRows, options.typeField, options.amountField, 'churn', amountMode) + amount(currentRows, options.typeField, options.amountField, 'churned', amountMode)
    const explicitEnding = movementSource === 'snapshot' ? snapshotValue(currentRows, options.amountField) : currentRows.map((row) => numberValue(row, 'ending_mrr')).find((value): value is number => value !== undefined)
    const movementDelta = amountMode === 'signed'
      ? newMrr + expansionMrr + reactivationMrr + contractionMrr + churnedMrr
      : newMrr + expansionMrr + reactivationMrr - contractionMrr - churnedMrr
    const endingMrr = explicitEnding ?? (beginningMrr === null ? null : movementSource === 'snapshot' ? beginningMrr : beginningMrr + movementDelta)
    const activeCustomers = currentRows.map((row) => numberValue(row, 'active_customers')).find((value): value is number => value !== undefined)
      ?? new Set(currentRows.map((row) => stringValue(row, options.customerField)).filter((value): value is string => Boolean(value))).size
    const spend = currentRows.reduce((sum, row) => sum + Math.abs(numberValue(row, options.spendField) ?? 0), 0)
    const newCustomers = currentRows.filter((row) => stringValue(row, options.typeField)?.toLowerCase() === 'new').length
    const arpa = activeCustomers > 0 && endingMrr !== null ? endingMrr / activeCustomers : null
    const churnCount = currentRows.filter((row) => ['churn', 'churned'].includes(stringValue(row, options.typeField)?.toLowerCase() ?? '')).length
    const logoChurn = safeDivide(churnCount, index === 0 ? options.beginningCustomers ?? 0 : output[index - 1]?.activeCustomers ?? 0)
    const revenueChurn = movementSource === 'snapshot' ? null : safeDivide(amountMode === 'signed' ? -churnedMrr : churnedMrr, beginningMrr ?? 0)
    const nrrBase = beginningMrr === null || movementSource === 'snapshot' ? null : amountMode === 'signed'
      ? beginningMrr + expansionMrr + reactivationMrr + contractionMrr + churnedMrr
      : beginningMrr + expansionMrr + reactivationMrr - contractionMrr - churnedMrr
    const nrr = safeDivide(nrrBase ?? 0, beginningMrr ?? 0)
    const cac = newCustomers > 0 ? spend / newCustomers : null
    const ltv = arpa !== null && options.grossMargin > 0 && revenueChurn !== null && revenueChurn > 0 ? arpa * options.grossMargin / revenueChurn : null
    const paybackMonths = cac !== null && arpa !== null && arpa > 0 && options.grossMargin > 0 ? cac / (arpa * options.grossMargin) : null
    if (beginningMrr === null) warnings.push(`Missing beginning MRR for ${period}; MRR growth and NRR are partial`)
    if (activeCustomers === 0) warnings.push(`No active customer count for ${period}`)
    output.push({
      period,
      beginningMrr: round(beginningMrr, 2),
      newMrr: round(newMrr, 2) ?? 0,
      expansionMrr: round(expansionMrr, 2) ?? 0,
      reactivationMrr: round(reactivationMrr, 2) ?? 0,
      contractionMrr: round(amountMode === 'signed' && contractionMrr !== 0 ? contractionMrr : contractionMrr, 2) ?? 0,
      churnedMrr: round(amountMode === 'signed' && churnedMrr !== 0 ? churnedMrr : churnedMrr, 2) ?? 0,
      endingMrr: round(endingMrr, 2),
      mrrGrowthRate: percentage(beginningMrr === null || endingMrr === null ? null : safeDivide(endingMrr - beginningMrr, beginningMrr)),
      activeCustomers: activeCustomers || null,
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
      totalSpend: rows.reduce((sum, row) => sum + Math.abs(numberValue(row, options.spendField) ?? 0), 0),
      totalNewCustomers: rows.filter((row) => stringValue(row, options.typeField)?.toLowerCase() === 'new').length,
    },
    warnings,
  }
}
