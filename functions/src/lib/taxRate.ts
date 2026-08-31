export interface DatedRate {
  effectiveFrom: Date
  rateBps: number
}

/**
 * Picks the rate in effect at `asOf` from `config/tax.rates` (docs/SCHEMA.md
 * §3) — the entry with the latest `effectiveFrom` that isn't after `asOf`.
 * This is what makes the rate "dated, not hardcoded": adding a new future-
 * dated entry changes what a *new* order gets charged without touching the
 * rate any already-confirmed order was charged (that rate is frozen onto
 * the order itself at confirm time, never looked up again).
 *
 * Takes plain Dates rather than Firestore Timestamps so it stays a pure,
 * emulator-free unit — the caller converts `config/tax`'s stored
 * Timestamps before calling this.
 */
export function currentTaxRateBps(rates: DatedRate[], asOf: Date): number {
  const applicable = rates
    .filter((r) => r.effectiveFrom.getTime() <= asOf.getTime())
    .sort((a, b) => b.effectiveFrom.getTime() - a.effectiveFrom.getTime())

  if (applicable.length === 0) {
    throw new Error(`No tax rate is configured effective as of ${asOf.toISOString()}.`)
  }
  return applicable[0].rateBps
}
