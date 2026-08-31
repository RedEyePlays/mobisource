import { describe, expect, it } from 'vitest'
import { validateBuyerFields } from './validateBuyer.js'

function baseBuyer(overrides = {}) {
  return {
    name: 'Acme Repair',
    type: 'repairShop',
    tier: 'tier2',
    terms: 'net15',
    ...overrides,
  }
}

describe('validateBuyerFields — create (requireAll)', () => {
  it('accepts a valid buyer', () => {
    expect(() => validateBuyerFields(baseBuyer(), { requireAll: true })).not.toThrow()
  })

  it('accepts an optional contact object', () => {
    expect(() =>
      validateBuyerFields(baseBuyer({ contact: { email: 'a@b.com' } }), { requireAll: true }),
    ).not.toThrow()
  })

  it('throws on a blank name', () => {
    expect(() => validateBuyerFields(baseBuyer({ name: '  ' }), { requireAll: true })).toThrow()
  })

  it('throws on an invalid type', () => {
    expect(() => validateBuyerFields(baseBuyer({ type: 'friend' }), { requireAll: true })).toThrow()
  })

  it('throws on an invalid tier', () => {
    expect(() => validateBuyerFields(baseBuyer({ tier: 'gold' }), { requireAll: true })).toThrow()
  })

  it('throws on invalid terms', () => {
    expect(() => validateBuyerFields(baseBuyer({ terms: 'net30' }), { requireAll: true })).toThrow()
  })

  it('throws when contact is not a plain object', () => {
    expect(() => validateBuyerFields(baseBuyer({ contact: 'nope' }), { requireAll: true })).toThrow()
    expect(() => validateBuyerFields(baseBuyer({ contact: [] }), { requireAll: true })).toThrow()
  })
})

describe('validateBuyerFields — partial update', () => {
  it('accepts updating just the tier', () => {
    expect(() => validateBuyerFields({ tier: 'tier3' })).not.toThrow()
  })

  it('throws on an invalid value for a field that is present', () => {
    expect(() => validateBuyerFields({ tier: 'platinum' })).toThrow()
  })

  it('ignores fields that are absent entirely', () => {
    expect(() => validateBuyerFields({})).not.toThrow()
  })
})
