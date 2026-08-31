import { describe, expect, it } from 'vitest'
import { resolveLinePrice } from './resolveLinePrice'
import { cents } from '../types'

// listPriceTier1=$100 (1-4u), listPriceTier2=$90 (5-19u), listPriceTier3=$80 (20+u)
const SKU = {
  listPriceRetail: cents(12000),
  listPriceTier1: cents(10000),
  listPriceTier2: cents(9000),
  listPriceTier3: cents(8000),
}

describe('resolveLinePrice (POS preview)', () => {
  it('gives a retail buyer listPriceRetail regardless of quantity or tier', () => {
    const buyer = { type: 'retail', tier: 'partner' } as const
    expect(resolveLinePrice({ sku: SKU, buyer, qty: 1 })).toBe(12000)
    expect(resolveLinePrice({ sku: SKU, buyer, qty: 40 })).toBe(12000)
  })

  it('standard buyer, qty 2 (1-4u bracket): both agree at $100', () => {
    const buyer = { type: 'repairShop', tier: 'standard' } as const
    expect(resolveLinePrice({ sku: SKU, buyer, qty: 2 })).toBe(10000)
  })

  it('standard buyer, qty 40 (20+u bracket): quantity improves on the floor to $80', () => {
    const buyer = { type: 'repairShop', tier: 'standard' } as const
    expect(resolveLinePrice({ sku: SKU, buyer, qty: 40 })).toBe(8000)
  })

  it('partner buyer, qty 2 (1-4u bracket): tier floor holds at $80, quantity does not downgrade it', () => {
    const buyer = { type: 'repairShop', tier: 'partner' } as const
    expect(resolveLinePrice({ sku: SKU, buyer, qty: 2 })).toBe(8000)
  })

  it('throws on an unknown tier', () => {
    const buyer = { type: 'broker', tier: 'gold' } as unknown as { type: 'broker'; tier: 'standard' }
    expect(() => resolveLinePrice({ sku: SKU, buyer, qty: 1 })).toThrow()
  })
})
