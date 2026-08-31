import { cents } from '../types'
import type { Cents, DonorCondition, TeardownProfileGrade } from '../types'

// ---------------------------------------------------------------------------
// Preview allocation, ported from functions/src/lib/allocateDonorCost.ts —
// duplicated rather than imported for the same reason as src/types.ts (the
// frontend bundle and the functions codebase are deployed independently).
// This is a PREVIEW only: the real allocation is computed authoritatively by
// the teardown callable, inside the transaction. Behaviour must stay
// byte-for-byte identical to the backend's, or the preview would lie to the
// operator about what's about to be charged to the donor.
// ---------------------------------------------------------------------------

export interface AllocationInputPart {
  skuCode: string
  expectedResaleCents: Cents
}

export interface AllocationResult {
  skuCode: string
  allocatedCostCents: Cents
}

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
 */
export function allocateDonorCost(donorCostCents: Cents, parts: AllocationInputPart[]): AllocationResult[] {
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

  const allocations: AllocationResult[] = parts.map((part) => ({
    skuCode: part.skuCode,
    allocatedCostCents: cents(Number((donorCost * BigInt(part.expectedResaleCents)) / total)),
  }))

  const allocatedSoFar = allocations.reduce((sum, allocation) => sum + allocation.allocatedCostCents, 0)
  const remainderCents = donorCostCents - allocatedSoFar

  let highestIndex = 0
  for (let i = 1; i < parts.length; i++) {
    if (parts[i].expectedResaleCents > parts[highestIndex].expectedResaleCents) {
      highestIndex = i
    }
  }
  allocations[highestIndex].allocatedCostCents = cents(allocations[highestIndex].allocatedCostCents + remainderCents)

  return allocations
}

/** donors.condition (A|B|C|D) -> teardownProfiles.donorGrade (AB|CD), per SCHEMA.md §3.5. */
export function mapDonorGradeToProfileGrade(condition: DonorCondition): TeardownProfileGrade {
  if (condition === 'A' || condition === 'B') return 'AB'
  if (condition === 'C' || condition === 'D') return 'CD'
  throw new Error(`Unknown donor condition: ${condition}`)
}
