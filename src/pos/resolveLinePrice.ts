import { cents } from '../types'
import type { Buyer, Cents, Sku } from '../types'

// ---------------------------------------------------------------------------
// Preview pricing, ported from functions/src/lib/resolveLinePrice.ts —
// duplicated rather than imported for the same reason as src/types.ts (the
// frontend bundle and the functions codebase are deployed independently).
// This is a PREVIEW only, for the running cart total as items are scanned —
// the real price is resolved authoritatively by createOrder, server-side,
// at checkout. Behaviour must stay byte-for-byte identical to the backend's,
// or the cart total would lie to the cashier about what's about to be
// charged.
// ---------------------------------------------------------------------------

type PriceableSku = Pick<Sku, 'listPriceRetail' | 'listPriceTier1' | 'listPriceTier2' | 'listPriceTier3'>
type PriceableBuyer = Pick<Buyer, 'type' | 'tier'>

const TIER_FLOOR_FIELD = {
  standard: 'listPriceTier1',
  preferred: 'listPriceTier2',
  partner: 'listPriceTier3',
} as const satisfies Record<Buyer['tier'], keyof PriceableSku>

function quantityBracketField(qty: number): keyof PriceableSku {
  if (qty >= 20) return 'listPriceTier3'
  if (qty >= 5) return 'listPriceTier2'
  return 'listPriceTier1'
}

export interface ResolveLinePriceInput {
  sku: PriceableSku
  buyer: PriceableBuyer
  qty: number
}

export function resolveLinePrice({ sku, buyer, qty }: ResolveLinePriceInput): Cents {
  if (buyer.type === 'retail') {
    return sku.listPriceRetail
  }

  const tierField = TIER_FLOOR_FIELD[buyer.tier]
  if (!tierField) {
    throw new Error(`Unknown buyer tier: ${buyer.tier}`)
  }

  const bracketField = quantityBracketField(qty)
  return cents(Math.min(sku[tierField], sku[bracketField]))
}
