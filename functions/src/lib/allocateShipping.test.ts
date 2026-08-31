import { describe, expect, it } from 'vitest'
import { cents } from './types.js'
import { allocateShipping } from './allocateShipping.js'
import type { ShippingLineInput } from './allocateShipping.js'

function line(skuCode: string, qty: number, overrideCents: number | null = null): ShippingLineInput {
  return { skuCode, qty, overrideCents: overrideCents == null ? null : cents(overrideCents) }
}

describe('allocateShipping', () => {
  it('splits shipping evenly across units when nothing is overridden', () => {
    const result = allocateShipping(cents(1000), [line('A', 5), line('B', 5)])
    expect(result).toEqual([
      { skuCode: 'A', shippingAllocatedCents: 500 },
      { skuCode: 'B', shippingAllocatedCents: 500 },
    ])
  })

  it('gives an overridden line its flat per-unit rate regardless of the total', () => {
    // B is oversized: $5.00/unit flat, 2 units = $10.00. Remaining $10.00 splits across A's 10 units = $1.00/unit.
    const result = allocateShipping(cents(2000), [line('A', 10), line('B', 2, 500)])
    expect(result).toEqual([
      { skuCode: 'A', shippingAllocatedCents: 1000 },
      { skuCode: 'B', shippingAllocatedCents: 1000 },
    ])
  })

  it('assigns the floor-division remainder to the first non-overridden line', () => {
    // 100 cents / 3 units = 33.33 -> floor 33, remainder 1 cent to the first line.
    const result = allocateShipping(cents(100), [line('A', 1), line('B', 1), line('C', 1)])
    expect(result).toEqual([
      { skuCode: 'A', shippingAllocatedCents: 34 },
      { skuCode: 'B', shippingAllocatedCents: 33 },
      { skuCode: 'C', shippingAllocatedCents: 33 },
    ])
    expect(result.reduce((sum, r) => sum + r.shippingAllocatedCents, 0)).toBe(100)
  })

  it('assigns the remainder to the first non-overridden line even when an earlier line is overridden', () => {
    // A is overridden (flat), so B is the first non-overridden line and gets the remainder.
    const result = allocateShipping(cents(1001), [line('A', 1, 0), line('B', 1), line('C', 1)])
    expect(result).toEqual([
      { skuCode: 'A', shippingAllocatedCents: 0 },
      { skuCode: 'B', shippingAllocatedCents: 501 },
      { skuCode: 'C', shippingAllocatedCents: 500 },
    ])
  })

  it('handles every unit being overridden with no remainder left over', () => {
    const result = allocateShipping(cents(1500), [line('A', 2, 500), line('B', 1, 500)])
    expect(result).toEqual([
      { skuCode: 'A', shippingAllocatedCents: 1000 },
      { skuCode: 'B', shippingAllocatedCents: 500 },
    ])
  })

  it('throws when every unit is overridden but shipping does not add up', () => {
    expect(() => allocateShipping(cents(2000), [line('A', 2, 500), line('B', 1, 500)])).toThrow(
      /cannot be allocated/,
    )
  })

  it('gives a single line the whole shipping total', () => {
    const result = allocateShipping(cents(750), [line('A', 3)])
    expect(result).toEqual([{ skuCode: 'A', shippingAllocatedCents: 750 }])
  })

  it('allocates zero shipping as zero everywhere, not an error', () => {
    const result = allocateShipping(cents(0), [line('A', 5), line('B', 3)])
    expect(result).toEqual([
      { skuCode: 'A', shippingAllocatedCents: 0 },
      { skuCode: 'B', shippingAllocatedCents: 0 },
    ])
  })

  it('throws on an empty lines array', () => {
    expect(() => allocateShipping(cents(100), [])).toThrow()
  })

  it('throws on a negative shipping total', () => {
    expect(() => allocateShipping(cents(-1), [line('A', 1)])).toThrow()
  })

  it('throws on a non-positive qty', () => {
    expect(() => allocateShipping(cents(100), [line('A', 0)])).toThrow()
  })

  it('throws on a negative override', () => {
    expect(() => allocateShipping(cents(100), [line('A', 1, -1)])).toThrow()
  })
})
