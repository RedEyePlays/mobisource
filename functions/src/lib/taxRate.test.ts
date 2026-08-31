import { describe, expect, it } from 'vitest'
import { currentTaxRateBps } from './taxRate.js'

describe('currentTaxRateBps', () => {
  it('picks the only rate when there is exactly one', () => {
    const rates = [{ effectiveFrom: new Date('2010-07-01'), rateBps: 1300 }]
    expect(currentTaxRateBps(rates, new Date('2026-01-01'))).toBe(1300)
  })

  it('picks the latest rate that is effective on or before the given date', () => {
    const rates = [
      { effectiveFrom: new Date('2010-07-01'), rateBps: 1300 },
      { effectiveFrom: new Date('2030-01-01'), rateBps: 1500 },
    ]
    expect(currentTaxRateBps(rates, new Date('2026-01-01'))).toBe(1300)
    expect(currentTaxRateBps(rates, new Date('2030-06-01'))).toBe(1500)
  })

  it('is inclusive of the effectiveFrom instant itself', () => {
    const rates = [
      { effectiveFrom: new Date('2010-07-01'), rateBps: 1300 },
      { effectiveFrom: new Date('2030-01-01T00:00:00.000Z'), rateBps: 1500 },
    ]
    expect(currentTaxRateBps(rates, new Date('2030-01-01T00:00:00.000Z'))).toBe(1500)
  })

  it('is unaffected by rate entries out of chronological order in the array', () => {
    const rates = [
      { effectiveFrom: new Date('2030-01-01'), rateBps: 1500 },
      { effectiveFrom: new Date('2010-07-01'), rateBps: 1300 },
    ]
    expect(currentTaxRateBps(rates, new Date('2026-01-01'))).toBe(1300)
  })

  it('throws when no rate is effective yet as of the given date', () => {
    const rates = [{ effectiveFrom: new Date('2030-01-01'), rateBps: 1500 }]
    expect(() => currentTaxRateBps(rates, new Date('2026-01-01'))).toThrow(/No tax rate/)
  })

  it('throws on an empty rates array', () => {
    expect(() => currentTaxRateBps([], new Date())).toThrow(/No tax rate/)
  })
})
