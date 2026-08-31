import { describe, expect, it } from 'vitest'
import { validateDonorIntake } from './validateDonorIntake.js'

function baseDonor(overrides = {}) {
  return {
    purchaseCost: 40000,
    condition: 'A',
    source: 'local',
    purchaseCurrency: 'CAD',
    fxRateUsed: null,
    imei: '011112223334445',
    imeiBlankReason: '',
    ...overrides,
  }
}

describe('validateDonorIntake', () => {
  it('accepts a valid CAD donor with an IMEI', () => {
    expect(() => validateDonorIntake(baseDonor())).not.toThrow()
  })

  it('accepts a valid USD donor with fxRateUsed', () => {
    expect(() =>
      validateDonorIntake(baseDonor({ purchaseCurrency: 'USD', fxRateUsed: 1.37 })),
    ).not.toThrow()
  })

  it('accepts a blank IMEI when a reason is given', () => {
    expect(() =>
      validateDonorIntake(baseDonor({ imei: '', imeiBlankReason: 'Dead board, unreadable.' })),
    ).not.toThrow()
  })

  it('throws on a negative purchaseCost', () => {
    expect(() => validateDonorIntake(baseDonor({ purchaseCost: -1 }))).toThrow()
  })

  it('throws on a non-integer purchaseCost', () => {
    expect(() => validateDonorIntake(baseDonor({ purchaseCost: 400.5 }))).toThrow()
  })

  it('throws on an invalid condition', () => {
    expect(() => validateDonorIntake(baseDonor({ condition: 'mint' }))).toThrow()
  })

  it('throws on an invalid source', () => {
    expect(() => validateDonorIntake(baseDonor({ source: 'ebay' }))).toThrow()
  })

  it('throws on an invalid purchaseCurrency', () => {
    expect(() => validateDonorIntake(baseDonor({ purchaseCurrency: 'EUR' }))).toThrow()
  })

  it('throws when purchaseCurrency is USD without fxRateUsed', () => {
    expect(() => validateDonorIntake(baseDonor({ purchaseCurrency: 'USD', fxRateUsed: null }))).toThrow()
  })

  it('throws when imei is blank without imeiBlankReason', () => {
    expect(() => validateDonorIntake(baseDonor({ imei: '', imeiBlankReason: '' }))).toThrow()
    expect(() => validateDonorIntake(baseDonor({ imei: '', imeiBlankReason: '   ' }))).toThrow()
  })
})
