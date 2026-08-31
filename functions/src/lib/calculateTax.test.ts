import { describe, expect, it } from 'vitest'
import { calculateTax } from './calculateTax.js'
import { cents } from './types.js'

const HST_ON_BPS = 1300 // 13%

describe('calculateTax', () => {
  it('charges 13% HST on a taxable buyer', () => {
    const result = calculateTax({ subtotal: cents(10000), taxStatus: 'taxable', rateBps: HST_ON_BPS })
    expect(result.tax).toBe(1300)
    expect(result.appliedRateBps).toBe(1300)
  })

  it('charges $0 for an exempt buyer, regardless of the configured rate', () => {
    const result = calculateTax({ subtotal: cents(10000), taxStatus: 'exempt', rateBps: HST_ON_BPS })
    expect(result.tax).toBe(0)
    expect(result.appliedRateBps).toBe(0)
  })

  it('charges $0 for a zeroRated buyer, regardless of the configured rate', () => {
    const result = calculateTax({ subtotal: cents(10000), taxStatus: 'zeroRated', rateBps: HST_ON_BPS })
    expect(result.tax).toBe(0)
    expect(result.appliedRateBps).toBe(0)
  })

  it('charges $0 tax on a $0 subtotal', () => {
    const result = calculateTax({ subtotal: cents(0), taxStatus: 'taxable', rateBps: HST_ON_BPS })
    expect(result.tax).toBe(0)
  })

  it('rounds half up to the nearest cent', () => {
    // 13% of $0.05 = 0.0065 -> 1 cent (would floor to 0)
    expect(calculateTax({ subtotal: cents(5), taxStatus: 'taxable', rateBps: HST_ON_BPS }).tax).toBe(1)
    // 13% of $0.03 = 0.0039 -> 0 cents
    expect(calculateTax({ subtotal: cents(3), taxStatus: 'taxable', rateBps: HST_ON_BPS }).tax).toBe(0)
    // 13% of $1.50 = 0.195 -> 20 cents (rounds up from .195... exact value: 150*1300/10000=19.5 -> 20)
    expect(calculateTax({ subtotal: cents(150), taxStatus: 'taxable', rateBps: HST_ON_BPS }).tax).toBe(20)
  })

  it('handles a single-cent subtotal without going negative or fractional', () => {
    expect(calculateTax({ subtotal: cents(1), taxStatus: 'taxable', rateBps: HST_ON_BPS }).tax).toBe(0)
  })

  it('supports a 0% rate (e.g. a future config entry) charging nothing even for a taxable buyer', () => {
    expect(calculateTax({ subtotal: cents(10000), taxStatus: 'taxable', rateBps: 0 }).tax).toBe(0)
  })
})
