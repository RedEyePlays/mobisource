import { describe, expect, it } from 'vitest'
import { assertAllocationSumsToDonorCost, mapDonorGradeToProfileGrade } from './teardownDonor.js'

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
    expect(() => mapDonorGradeToProfileGrade('mint')).toThrow()
  })
})

describe('assertAllocationSumsToDonorCost', () => {
  it('passes when the sum matches exactly', () => {
    expect(() => assertAllocationSumsToDonorCost([16925, 9230, 4615, 4615, 2692, 1923], 40000)).not.toThrow()
  })

  it('throws when the sum is short', () => {
    expect(() => assertAllocationSumsToDonorCost([100, 100], 300)).toThrow()
  })

  it('throws when the sum overshoots', () => {
    expect(() => assertAllocationSumsToDonorCost([100, 250], 300)).toThrow()
  })
})
