import { cents } from '../types'
import type { BuyerTaxStatus, Cents } from '../types'

// ---------------------------------------------------------------------------
// Preview tax, ported from functions/src/lib/calculateTax.ts — duplicated
// rather than imported for the same reason as resolveLinePrice.ts (the
// frontend bundle and the functions codebase are deployed independently).
// This is a PREVIEW only, for the "Charge $X" total before checkout — the
// real tax is calculated authoritatively by confirmOrder, server-side, and
// frozen onto the order. Behaviour must stay identical to the backend's.
// ---------------------------------------------------------------------------

export interface CalculateTaxInput {
  subtotal: Cents
  taxStatus: BuyerTaxStatus
  rateBps: number
}

export interface CalculateTaxResult {
  tax: Cents
  appliedRateBps: number
}

export function calculateTax({ subtotal, taxStatus, rateBps }: CalculateTaxInput): CalculateTaxResult {
  if (taxStatus !== 'taxable') {
    return { tax: cents(0), appliedRateBps: 0 }
  }

  const tax = cents(Math.round((subtotal * rateBps) / 10000))
  return { tax, appliedRateBps: rateBps }
}
