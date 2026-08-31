// buyers.tier -> the SKU price field that is this buyer's guaranteed floor.
// docs/SCHEMA.md §3 "Line pricing: buyer tier vs. quantity break".
const TIER_FLOOR_FIELD = {
  standard: 'listPriceTier1',
  preferred: 'listPriceTier2',
  partner: 'listPriceTier3',
}

function quantityBracketField(qty) {
  if (qty >= 20) return 'listPriceTier3'
  if (qty >= 5) return 'listPriceTier2'
  return 'listPriceTier1'
}

/**
 * Resolves a line's unitPrice (cents) server-side, per docs/SCHEMA.md §3.
 * A retail buyer always pays listPriceRetail. Otherwise, the buyer's tier
 * sets a price floor (the worst price they ever pay); the line's actual
 * quantity can only improve on it, never make it worse — hence min().
 */
export function resolveLinePrice({ sku, buyer, qty }) {
  if (buyer.type === 'retail') {
    return sku.listPriceRetail
  }

  const tierField = TIER_FLOOR_FIELD[buyer.tier]
  if (!tierField) {
    throw new Error(`Unknown buyer tier: ${buyer.tier}`)
  }

  const bracketField = quantityBracketField(qty)
  return Math.min(sku[tierField], sku[bracketField])
}
