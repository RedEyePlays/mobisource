import { cents } from './types.js'
import type { BuyerTaxStatus, Cents } from './types.js'

export interface CalculateTaxInput {
  /** Tax is calculated on the order's subtotal as a whole, not per line — docs/SCHEMA.md §3. */
  subtotal: Cents
  taxStatus: BuyerTaxStatus
  /** The rate in effect (see taxRate.ts), in basis points — 1300 = 13%. */
  rateBps: number
}

export interface CalculateTaxResult {
  tax: Cents
  /** The rate actually applied — 0 for an exempt/zeroRated buyer, even though `rateBps` was passed in nonzero. This is what gets frozen onto the order, not the input rate. */
  appliedRateBps: number
}

/**
 * exempt and zeroRated both charge $0 HST. They're kept as distinct
 * statuses (rather than collapsing to one 'noTax' value) because they mean
 * different things on a real HST return — zero-rated supplies still count
 * toward taxable revenue for input tax credit purposes, exempt supplies
 * don't — even though this codebase doesn't yet do anything with that
 * distinction beyond charging $0 either way. Piece 1 didn't ask for more
 * than that, so this is the whole rule; not inventing further treatment.
 */
export function calculateTax({ subtotal, taxStatus, rateBps }: CalculateTaxInput): CalculateTaxResult {
  if (taxStatus !== 'taxable') {
    return { tax: cents(0), appliedRateBps: 0 }
  }

  // Integer cents throughout: rateBps is basis points (out of 10,000), so
  // subtotal * rateBps is still an integer, and this is the one division —
  // rounded half-up (Math.round; JS rounds .5 away from zero for positive
  // inputs, and a subtotal is never negative) to the nearest cent. This is
  // the only rounding step — tax is computed once on the whole subtotal,
  // never per line, so there's no remainder-across-lines to reconcile.
  const tax = cents(Math.round((subtotal * rateBps) / 10000))
  return { tax, appliedRateBps: rateBps }
}
