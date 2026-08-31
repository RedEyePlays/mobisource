// ---------------------------------------------------------------------------
// Preview rate lookup, ported from functions/src/lib/taxRate.ts — duplicated
// for the same reason as calculateTax.ts in this directory.
// ---------------------------------------------------------------------------

export interface DatedRate {
  effectiveFrom: Date
  rateBps: number
}

export function currentTaxRateBps(rates: DatedRate[], asOf: Date): number {
  const applicable = rates
    .filter((r) => r.effectiveFrom.getTime() <= asOf.getTime())
    .sort((a, b) => b.effectiveFrom.getTime() - a.effectiveFrom.getTime())

  if (applicable.length === 0) {
    throw new Error(`No tax rate is configured effective as of ${asOf.toISOString()}.`)
  }
  return applicable[0].rateBps
}
