/**
 * Allocates a donor's cost across harvested parts, proportional to each
 * part's expected resale value. Per docs/SCHEMA.md §4.
 *
 * Uses BigInt division throughout so every intermediate value stays an
 * exact integer — no floating-point rounding can creep into a cost
 * allocation. Each part's share is floored, then the leftover cents
 * (always >= 0, since a floor never overshoots) are assigned to the
 * highest-expected-resale part, so the allocations always sum to exactly
 * donorCostCents.
 *
 * @param {number} donorCostCents - non-negative integer
 * @param {{ skuCode: string, expectedResaleCents: number }[]} parts
 * @returns {{ skuCode: string, allocatedCostCents: number }[]}
 */
export function allocateDonorCost(donorCostCents, parts) {
  if (!Array.isArray(parts) || parts.length === 0) {
    throw new Error('parts must be a non-empty array')
  }

  if (donorCostCents < 0) {
    throw new Error('donorCostCents must not be negative')
  }

  for (const part of parts) {
    if (part.expectedResaleCents < 0) {
      throw new Error(`expectedResaleCents for ${part.skuCode} must not be negative`)
    }
  }

  const totalExpectedResaleCents = parts.reduce((sum, part) => sum + part.expectedResaleCents, 0)
  if (totalExpectedResaleCents === 0) {
    throw new Error('total expected resale must be greater than zero')
  }

  const donorCost = BigInt(donorCostCents)
  const total = BigInt(totalExpectedResaleCents)

  const allocations = parts.map((part) => ({
    skuCode: part.skuCode,
    allocatedCostCents: Number((donorCost * BigInt(part.expectedResaleCents)) / total),
  }))

  const allocatedSoFar = allocations.reduce((sum, allocation) => sum + allocation.allocatedCostCents, 0)
  const remainderCents = donorCostCents - allocatedSoFar

  let highestIndex = 0
  for (let i = 1; i < parts.length; i++) {
    if (parts[i].expectedResaleCents > parts[highestIndex].expectedResaleCents) {
      highestIndex = i
    }
  }
  allocations[highestIndex].allocatedCostCents += remainderCents

  return allocations
}
