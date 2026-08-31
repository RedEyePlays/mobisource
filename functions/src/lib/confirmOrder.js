import { FieldValue } from 'firebase-admin/firestore'

/**
 * Confirms a quoted order atomically: flips each reserved stockItem to
 * sold (price, date, buyer), writes a 'sale' movement per line, and sets
 * the order to confirmed. If any assertion fails, everything queued above
 * is discarded — nothing commits.
 */
export async function confirmOrder(db, { orderId }) {
  if (!orderId) {
    throw new Error('orderId is required.')
  }

  return db.runTransaction(async (tx) => {
    const orderRef = db.collection('salesOrders').doc(orderId)
    const orderSnap = await tx.get(orderRef)
    if (!orderSnap.exists) {
      throw new Error(`Order not found: ${orderId}`)
    }
    const order = orderSnap.data()
    if (order.status !== 'quoted') {
      throw new Error(`Order status is '${order.status}', expected 'quoted'.`)
    }

    const itemRefs = order.lines.map((line) => db.collection('stockItems').doc(line.itemId))
    const itemSnaps = await Promise.all(itemRefs.map((ref) => tx.get(ref)))

    itemSnaps.forEach((snap, i) => {
      const line = order.lines[i]
      if (!snap.exists) {
        throw new Error(`stockItem not found: ${line.itemId}`)
      }
      if (snap.data().status !== 'reserved') {
        throw new Error(`stockItem ${line.itemId} is '${snap.data().status}', expected 'reserved'.`)
      }
    })

    order.lines.forEach((line, i) => {
      tx.update(itemRefs[i], {
        status: 'sold',
        soldPrice: line.unitPrice,
        soldDate: FieldValue.serverTimestamp(),
        buyerId: order.buyerId,
      })

      const movementRef = db.collection('stockMovements').doc()
      tx.set(movementRef, {
        movementId: movementRef.id,
        at: FieldValue.serverTimestamp(),
        type: 'sale',
        skuCode: line.skuCode,
        itemId: line.itemId,
        qty: -1,
        unitCost: line.unitCost,
        ref: orderId,
        brand: 'mobisource',
        note: '',
      })
    })

    tx.update(orderRef, { status: 'confirmed' })

    return { orderId, status: 'confirmed' }
  })
}
