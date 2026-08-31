import type { Grade, Sku } from '../types'

export interface ItemCartLine {
  kind: 'item'
  itemId: string
  skuCode: string
  sku: Sku
  grade: Grade
  /** Always 1 — a serialized line is exactly one specific stockItem. Present so pricing/total code can treat both cart line kinds uniformly. */
  qty: 1
}

export interface BulkCartLine {
  kind: 'bulk'
  skuCode: string
  sku: Sku
  qty: number
  /** qtyOnHand as of the last scan/search or add — a hint for the qty stepper, not authoritative. The server re-checks for real at checkout. */
  qtyOnHand: number
}

export type CartLine = ItemCartLine | BulkCartLine

export function addItemLine(cart: CartLine[], line: ItemCartLine): CartLine[] {
  if (cart.some((l) => l.kind === 'item' && l.itemId === line.itemId)) {
    throw new Error(`${line.itemId} is already in the cart.`)
  }
  return [...cart, line]
}

export function addOrIncrementBulkLine(
  cart: CartLine[],
  skuCode: string,
  sku: Sku,
  qtyOnHand: number,
  addQty = 1,
): CartLine[] {
  const idx = cart.findIndex((l) => l.kind === 'bulk' && l.skuCode === skuCode)
  if (idx === -1) {
    return [...cart, { kind: 'bulk', skuCode, sku, qty: addQty, qtyOnHand }]
  }
  return cart.map((l, i) => (i === idx && l.kind === 'bulk' ? { ...l, qty: l.qty + addQty, qtyOnHand } : l))
}

export function updateBulkQty(cart: CartLine[], skuCode: string, qty: number): CartLine[] {
  return cart.map((l) => (l.kind === 'bulk' && l.skuCode === skuCode ? { ...l, qty } : l))
}

export function removeCartLine(cart: CartLine[], index: number): CartLine[] {
  return cart.filter((_, i) => i !== index)
}
