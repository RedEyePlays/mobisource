import { FieldValue } from 'firebase-admin/firestore'
import { resolveLinePrice } from './resolveLinePrice.js'

/**
 * Quotes an order: resolves pricing server-side (the client never supplies
 * or sees a price) and reserves each stockItem so a second, concurrent
 * quote can't also claim it. Nothing is sold yet — see confirmOrder.js.
 *
 * Serialized items only: one line per specific itemId, qty always 1.
 */
export async function createOrder(db, { buyerId, itemIds }) {
  if (!buyerId) {
    throw new Error('buyerId is required.')
  }
  if (!Array.isArray(itemIds) || itemIds.length === 0) {
    throw new Error('itemIds must be a non-empty array.')
  }
  if (new Set(itemIds).size !== itemIds.length) {
    throw new Error('itemIds must not contain duplicates.')
  }

  const orderRef = db.collection('salesOrders').doc()

  return db.runTransaction(async (tx) => {
    const buyerRef = db.collection('buyers').doc(buyerId)
    const buyerSnap = await tx.get(buyerRef)
    if (!buyerSnap.exists) {
      throw new Error(`Buyer not found: ${buyerId}`)
    }
    const buyer = buyerSnap.data()

    const itemRefs = itemIds.map((id) => db.collection('stockItems').doc(id))
    const itemSnaps = await Promise.all(itemRefs.map((ref) => tx.get(ref)))

    const items = itemSnaps.map((snap, i) => {
      if (!snap.exists) {
        throw new Error(`stockItem not found: ${itemIds[i]}`)
      }
      const item = snap.data()
      if (item.status !== 'inStock') {
        throw new Error(`stockItem ${itemIds[i]} is '${item.status}', expected 'inStock'.`)
      }
      return { ref: itemRefs[i], id: itemIds[i], ...item }
    })

    const skuRefs = items.map((item) => db.collection('skus').doc(item.skuCode))
    const skuSnaps = await Promise.all(skuRefs.map((ref) => tx.get(ref)))

    const lines = items.map((item, i) => {
      if (!skuSnaps[i].exists) {
        throw new Error(`SKU not found: ${item.skuCode}`)
      }
      const sku = skuSnaps[i].data()
      const unitPrice = resolveLinePrice({ sku, buyer, qty: 1 })
      return {
        skuCode: item.skuCode,
        itemId: item.id,
        qty: 1,
        unitPrice,
        unitCost: item.allocatedCost,
      }
    })

    const subtotal = lines.reduce((sum, line) => sum + line.unitPrice, 0)
    // No tax rate exists anywhere in the schema (no HST config, nothing) —
    // rather than guess a rate and bake a possibly-wrong number into money
    // code, this is 0 until a real rate source is defined.
    const tax = 0
    const total = subtotal + tax

    tx.set(orderRef, {
      orderId: orderRef.id,
      buyerId,
      lines,
      subtotal,
      tax,
      total,
      status: 'quoted',
      createdAt: FieldValue.serverTimestamp(),
    })

    for (const item of items) {
      tx.update(item.ref, { status: 'reserved' })
    }

    return { orderId: orderRef.id, subtotal, tax, total, lines }
  })
}
