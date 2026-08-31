import { describe, expect, it } from 'vitest'
import { allocateDonorCost } from './allocateDonorCost.js'

function sum(allocations) {
  return allocations.reduce((total, allocation) => total + allocation.allocatedCostCents, 0)
}

function byCode(allocations) {
  return Object.fromEntries(allocations.map((a) => [a.skuCode, a.allocatedCostCents]))
}

describe('allocateDonorCost', () => {
  it('allocates the §4 worked example ($400 mint iPhone 14 Pro donor)', () => {
    // docs/SCHEMA.md §4 displays each share rounded to the nearest cent for
    // readability (169.23, 92.31, ...), which itself only sums to $399.99 —
    // not $400.00. This function floors each share and hands the leftover
    // cent(s) to the highest-expected-resale part (the screen here), which
    // is the actual rule from §4 and is what makes the sum exact.
    const result = allocateDonorCost(40000, [
      { skuCode: 'MS-SCRN-IP14P-A-PULL', expectedResaleCents: 22000 },
      { skuCode: 'MS-LOGIC-IP14P-A-PULL', expectedResaleCents: 12000 },
      { skuCode: 'MS-CAMR-IP14P-A-PULL', expectedResaleCents: 6000 },
      { skuCode: 'MS-BGLS-IP14P-A-PULL', expectedResaleCents: 6000 },
      { skuCode: 'MS-TAPT-IP14P-A-PULL', expectedResaleCents: 3500 },
      { skuCode: 'MS-BATT-IP14P-A-PULL', expectedResaleCents: 2500 },
    ])

    expect(byCode(result)).toEqual({
      'MS-SCRN-IP14P-A-PULL': 16925,
      'MS-LOGIC-IP14P-A-PULL': 9230,
      'MS-CAMR-IP14P-A-PULL': 4615,
      'MS-BGLS-IP14P-A-PULL': 4615,
      'MS-TAPT-IP14P-A-PULL': 2692,
      'MS-BATT-IP14P-A-PULL': 1923,
    })
    expect(sum(result)).toBe(40000)
  })

  it('assigns the leftover cent to the highest-value part when naive rounding would be off by one', () => {
    // 100 / 3 = 33.33... per part. Flooring each gives 33+33+33 = 99, one
    // cent short of 100 — the case naive per-part rounding gets wrong.
    const result = allocateDonorCost(100, [
      { skuCode: 'A', expectedResaleCents: 1 },
      { skuCode: 'B', expectedResaleCents: 1 },
      { skuCode: 'C', expectedResaleCents: 1 },
    ])

    expect(byCode(result)).toEqual({ A: 34, B: 33, C: 33 })
    expect(sum(result)).toBe(100)
  })

  it('gives a single part the whole donor cost', () => {
    const result = allocateDonorCost(12345, [{ skuCode: 'MS-LOGIC-IP14P-A-PULL', expectedResaleCents: 999 }])

    expect(result).toEqual([{ skuCode: 'MS-LOGIC-IP14P-A-PULL', allocatedCostCents: 12345 }])
  })

  it('throws on an empty parts array', () => {
    expect(() => allocateDonorCost(40000, [])).toThrow()
  })

  it('throws when total expected resale is zero', () => {
    expect(() =>
      allocateDonorCost(40000, [
        { skuCode: 'A', expectedResaleCents: 0 },
        { skuCode: 'B', expectedResaleCents: 0 },
      ]),
    ).toThrow()
  })

  it('throws on a negative donor cost', () => {
    expect(() => allocateDonorCost(-1, [{ skuCode: 'A', expectedResaleCents: 100 }])).toThrow()
  })

  it('throws on a negative expected resale', () => {
    expect(() =>
      allocateDonorCost(40000, [
        { skuCode: 'A', expectedResaleCents: -100 },
        { skuCode: 'B', expectedResaleCents: 100 },
      ]),
    ).toThrow()
  })
})
