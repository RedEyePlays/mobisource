import { describe, expect, it } from 'vitest'
import { addItemLine, addOrIncrementBulkLine, removeCartLine, updateBulkQty } from './cart'
import type { CartLine, ItemCartLine } from './cart'
import { cents } from '../types'
import type { Sku } from '../types'

const SKU: Sku = {
  skuCode: 'MS-BATT-IP14P-N-AFT',
  partType: 'BATT',
  model: 'IP14P',
  grade: 'N',
  source: 'AFT',
  trackingMode: 'bulk',
  listPriceRetail: cents(2200),
  listPriceTier1: cents(2000),
  listPriceTier2: cents(1800),
  listPriceTier3: cents(1600),
  expectedResale: cents(1500),
  active: true,
}

function itemLine(itemId: string): ItemCartLine {
  return { kind: 'item', itemId, skuCode: 'MS-SCRN-IP14P-A-PULL', sku: SKU, grade: 'A', qty: 1 }
}

describe('addItemLine', () => {
  it('adds a serialized item to an empty cart', () => {
    const cart = addItemLine([], itemLine('item1'))
    expect(cart).toHaveLength(1)
    expect(cart[0]).toMatchObject({ kind: 'item', itemId: 'item1' })
  })

  it('rejects adding the same itemId twice', () => {
    const cart = addItemLine([], itemLine('item1'))
    expect(() => addItemLine(cart, itemLine('item1'))).toThrow(/already in the cart/)
  })
})

describe('addOrIncrementBulkLine', () => {
  it('adds a new bulk line at the given qty', () => {
    const cart = addOrIncrementBulkLine([], SKU.skuCode, SKU, 50, 3)
    expect(cart).toEqual([{ kind: 'bulk', skuCode: SKU.skuCode, sku: SKU, qty: 3, qtyOnHand: 50 }])
  })

  it('increments an existing bulk line rather than duplicating it', () => {
    let cart: CartLine[] = []
    cart = addOrIncrementBulkLine(cart, SKU.skuCode, SKU, 50, 1)
    cart = addOrIncrementBulkLine(cart, SKU.skuCode, SKU, 50, 1)
    expect(cart).toHaveLength(1)
    expect((cart[0] as CartLine & { qty: number }).qty).toBe(2)
  })

  it('defaults to adding 1 unit', () => {
    const cart = addOrIncrementBulkLine([], SKU.skuCode, SKU, 50)
    expect((cart[0] as CartLine & { qty: number }).qty).toBe(1)
  })
})

describe('updateBulkQty', () => {
  it('sets a bulk line to an exact qty', () => {
    let cart = addOrIncrementBulkLine([], SKU.skuCode, SKU, 50, 1)
    cart = updateBulkQty(cart, SKU.skuCode, 7)
    expect((cart[0] as CartLine & { qty: number }).qty).toBe(7)
  })

  it('leaves other lines untouched', () => {
    let cart = addItemLine([], itemLine('item1'))
    cart = addOrIncrementBulkLine(cart, SKU.skuCode, SKU, 50, 1)
    cart = updateBulkQty(cart, SKU.skuCode, 9)
    expect(cart[0]).toMatchObject({ kind: 'item', itemId: 'item1' })
  })
})

describe('removeCartLine', () => {
  it('removes exactly the line at the given index', () => {
    let cart: CartLine[] = []
    cart = addItemLine(cart, itemLine('item1'))
    cart = addItemLine(cart, itemLine('item2'))
    cart = removeCartLine(cart, 0)
    expect(cart).toHaveLength(1)
    expect(cart[0]).toMatchObject({ itemId: 'item2' })
  })
})
