import { cents, type Cents } from './types.js'

export interface ShippingLineInput {
  skuCode: string
  qty: number
  /** Flat per-unit shipping charge for this line's units (oversized items), already in CAD cents. Null if this line splits the remaining shipping like everyone else. */
  overrideCents: Cents | null
}

export interface ShippingAllocationResult {
  skuCode: string
  /** This line's total shipping share (its whole qty), in CAD cents. */
  shippingAllocatedCents: Cents
}

/**
 * Splits a shipment's total shipping cost across its lines. Per the bulk
 * receiving design: an overridden line (oversized items) pays its flat
 * per-unit rate regardless of everyone else; the remaining shipping splits
 * evenly, per unit, across the remaining lines' units. The remainder from
 * that floor-division (there's no natural "highest value" tiebreak here,
 * unlike teardown cost allocation) goes to the first non-overridden line.
 *
 * Currency-agnostic — the caller converts to CAD cents first (shipping can
 * be billed in CAD or USD; see receiveBulkShipment/applyReceiptShipping).
 */
export function allocateShipping(totalShippingCents: Cents, lines: ShippingLineInput[]): ShippingAllocationResult[] {
  if (!Array.isArray(lines) || lines.length === 0) {
    throw new Error('lines must be a non-empty array')
  }
  if (totalShippingCents < 0) {
    throw new Error('totalShippingCents must not be negative')
  }
  for (const line of lines) {
    if (!Number.isInteger(line.qty) || line.qty <= 0) {
      throw new Error(`qty for ${line.skuCode} must be a positive integer`)
    }
    if (line.overrideCents != null && line.overrideCents < 0) {
      throw new Error(`overrideCents for ${line.skuCode} must not be negative`)
    }
  }

  const overriddenShippingCents = lines.reduce(
    (sum, line) => sum + (line.overrideCents != null ? line.overrideCents * line.qty : 0),
    0,
  )
  const overriddenUnits = lines.reduce((sum, line) => sum + (line.overrideCents != null ? line.qty : 0), 0)
  const totalUnits = lines.reduce((sum, line) => sum + line.qty, 0)
  const remainingUnits = totalUnits - overriddenUnits
  const remainingCents = totalShippingCents - overriddenShippingCents

  if (remainingUnits === 0) {
    if (remainingCents !== 0) {
      throw new Error(
        `${remainingCents} cents of shipping cannot be allocated — every unit has an override. Adjust an override or the shipping total.`,
      )
    }
    return lines.map((line) => ({
      skuCode: line.skuCode,
      shippingAllocatedCents: cents((line.overrideCents ?? 0) * line.qty),
    }))
  }

  const perUnitCents = Math.floor(remainingCents / remainingUnits)
  const remainderCents = remainingCents - perUnitCents * remainingUnits
  const firstNonOverriddenIndex = lines.findIndex((line) => line.overrideCents == null)

  return lines.map((line, i) => {
    if (line.overrideCents != null) {
      return { skuCode: line.skuCode, shippingAllocatedCents: cents(line.overrideCents * line.qty) }
    }
    const bonus = i === firstNonOverriddenIndex ? remainderCents : 0
    return { skuCode: line.skuCode, shippingAllocatedCents: cents(perUnitCents * line.qty + bonus) }
  })
}
