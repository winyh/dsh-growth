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
}

function amount(rows: Row[], typeField: string, amountField: string, type: string): number {
  return rows.filter((row) => stringValue(row, typeField)?.toLowerCase() === type).reduce((sum, row) => sum + (numberValue(row, amountField) ?? 0), 0)
}

export function analyzeEconomics(source: string, rows: Row[], options: EconomicsOptions): EconomicsAnalysis {
  const warnings: string[] = []
  const periods = Array.from(new Set(rows.map((row) => stringValue(row, options.periodField)).filter((item): item is string => Boolean(item)))).sort()
  if (periods.length === 0) warnings.push(`No period values found in '${options.periodField}'`)
  const output: EconomicsAnalysis['periods'] = []
  periods.forEach((period, index) => {
    const currentRows = rows.filter((row) => stringValue(row, options.periodField) === period)
    const beginningMrr: number | null = index === 0 ? options.beginningMrr ?? null : output[index - 1]?.endingMrr ?? null
    const newMrr = amount(currentRows, options.typeField, options.amountField, 'new')
    const expansionMrr = amount(currentRows, options.typeField, options.amountField, 'expansion')
    const reactivationMrr = amount(currentRows, options.typeField, options.amountField, 'reactivation')
    const contractionMrr = amount(currentRows, options.typeField, options.amountField, 'contraction')
    const churnedMrr = amount(currentRows, options.typeField, options.amountField, 'churn') + amount(currentRows, options.typeField, options.amountField, 'churned')
    const explicitEnding = currentRows.map((row) => numberValue(row, 'ending_mrr')).find((value): value is number => value !== undefined)
    const endingMrr = explicitEnding ?? (beginningMrr === null ? null : beginningMrr + newMrr + expansionMrr + reactivationMrr - contractionMrr - churnedMrr)
    const activeCustomers = currentRows.map((row) => numberValue(row, 'active_customers')).find((value): value is number => value !== undefined)
      ?? new Set(currentRows.map((row) => stringValue(row, options.customerField)).filter((value): value is string => Boolean(value))).size
    const spend = currentRows.reduce((sum, row) => sum + (numberValue(row, options.spendField) ?? 0), 0)
    const newCustomers = currentRows.filter((row) => stringValue(row, options.typeField)?.toLowerCase() === 'new').length
    const arpa = activeCustomers > 0 && endingMrr !== null ? endingMrr / activeCustomers : null
    const logoChurn = safeDivide(currentRows.filter((row) => ['churn', 'churned'].includes(stringValue(row, options.typeField)?.toLowerCase() ?? '')).length, index === 0 ? options.beginningCustomers ?? 0 : output[index - 1]?.activeCustomers ?? 0)
    const revenueChurn = safeDivide(churnedMrr, beginningMrr ?? 0)
    const nrr = beginningMrr === null ? null : safeDivide(beginningMrr + expansionMrr + reactivationMrr - contractionMrr - churnedMrr, beginningMrr)
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
      contractionMrr: round(contractionMrr, 2) ?? 0,
      churnedMrr: round(churnedMrr, 2) ?? 0,
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
    periods: output,
    totals: {
      endingMrr,
      arr: endingMrr === null ? null : endingMrr * 12,
      totalSpend: rows.reduce((sum, row) => sum + (numberValue(row, options.spendField) ?? 0), 0),
      totalNewCustomers: rows.filter((row) => stringValue(row, options.typeField)?.toLowerCase() === 'new').length,
    },
    warnings,
  }
}
