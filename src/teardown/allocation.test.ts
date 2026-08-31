import { describe, expect, it } from 'vitest'
import { cents } from '../types'
import { allocateDonorCost, mapDonorGradeToProfileGrade } from './allocation'
import type { AllocationResult } from './allocation'

function sum(allocations: AllocationResult[]) {
  return allocations.reduce((total, allocation) => total + allocation.allocatedCostCents, 0)
}

function byCode(allocations: AllocationResult[]) {
  return Object.fromEntries(allocations.map((a) => [a.skuCode, a.allocatedCostCents]))
}

describe('allocateDonorCost (preview)', () => {
  it('allocates the §4 worked example ($400 mint iPhone 14 Pro donor) — must match the backend exactly', () => {
    const result = allocateDonorCost(cents(40000), [
      { skuCode: 'MS-SCRN-IP14P-A-PULL', expectedResaleCents: cents(22000) },
      { skuCode: 'MS-LOGIC-IP14P-A-PULL', expectedResaleCents: cents(12000) },
      { skuCode: 'MS-CAMR-IP14P-A-PULL', expectedResaleCents: cents(6000) },
      { skuCode: 'MS-BGLS-IP14P-A-PULL', expectedResaleCents: cents(6000) },
      { skuCode: 'MS-TAPT-IP14P-A-PULL', expectedResaleCents: cents(3500) },
      { skuCode: 'MS-BATT-IP14P-A-PULL', expectedResaleCents: cents(2500) },
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
    const result = allocateDonorCost(cents(100), [
      { skuCode: 'A', expectedResaleCents: cents(1) },
      { skuCode: 'B', expectedResaleCents: cents(1) },
      { skuCode: 'C', expectedResaleCents: cents(1) },
    ])

    expect(byCode(result)).toEqual({ A: 34, B: 33, C: 33 })
    expect(sum(result)).toBe(100)
  })

  it('gives a single part the whole donor cost', () => {
    const result = allocateDonorCost(cents(12345), [{ skuCode: 'MS-LOGIC-IP14P-A-PULL', expectedResaleCents: cents(999) }])
    expect(result).toEqual([{ skuCode: 'MS-LOGIC-IP14P-A-PULL', allocatedCostCents: 12345 }])
  })

  it('throws on an empty parts array (nothing ticked harvested yet)', () => {
    expect(() => allocateDonorCost(cents(40000), [])).toThrow()
  })

  it('throws when total expected resale is zero', () => {
    expect(() =>
      allocateDonorCost(cents(40000), [
        { skuCode: 'A', expectedResaleCents: cents(0) },
        { skuCode: 'B', expectedResaleCents: cents(0) },
      ]),
    ).toThrow()
  })

  it('throws on a negative donor cost', () => {
    expect(() => allocateDonorCost(cents(-1), [{ skuCode: 'A', expectedResaleCents: cents(100) }])).toThrow()
  })

  it('throws on a negative expected resale', () => {
    expect(() =>
      allocateDonorCost(cents(40000), [
        { skuCode: 'A', expectedResaleCents: cents(-100) },
        { skuCode: 'B', expectedResaleCents: cents(100) },
      ]),
    ).toThrow()
  })
})

describe('mapDonorGradeToProfileGrade', () => {
  it('maps A and B to AB', () => {
    expect(mapDonorGradeToProfileGrade('A')).toBe('AB')
    expect(mapDonorGradeToProfileGrade('B')).toBe('AB')
  })

  it('maps C and D to CD', () => {
    expect(mapDonorGradeToProfileGrade('C')).toBe('CD')
    expect(mapDonorGradeToProfileGrade('D')).toBe('CD')
  })

  it('throws on an unknown condition', () => {
    expect(() => mapDonorGradeToProfileGrade('mint' as unknown as 'A')).toThrow()
  })
})
