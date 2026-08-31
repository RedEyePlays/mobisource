import type { Firestore, WithFieldValue } from 'firebase-admin/firestore'
import { FieldValue } from 'firebase-admin/firestore'
import type { SalesOrder, StockItem, StockMovement } from './types.js'

export interface CancelOrderInput {
  orderId: string
  /** Free-text audit note — distinguishes a person's explicit cancel from the auto-expiry sweep (expireStaleQuotes.ts), which passes its own. */
  note?: string
}

export interface CancelOrderResult {
  orderId: string
  status: 'cancelled'
}

/**
 * Cancels a still-quoted order: releases every reserved serialized item
 * back to inStock and writes a 'release' movement per item — nothing about
 * stock changes silently. A bulk line needs no release: createOrder never
 * decrements bulkStock at quote time (only a soft, point-in-time
 * availability check — see createOrder.ts), so there's nothing held to let
 * go of.
 *
 * Only a 'quoted' order can be cancelled — a confirmed sale is reversed
 * through a return (processReturn.ts), not a cancellation.
 */
export async function cancelOrder(
  db: Firestore,
  { orderId, note = 'quote cancelled' }: CancelOrderInput,
): Promise<CancelOrderResult> {
  if (!orderId) {
    throw new Error('orderId is required.')
  }

  return db.runTransaction(async (tx) => {
    const orderRef = db.collection('salesOrders').doc(orderId)
    const orderSnap = await tx.get(orderRef)
    if (!orderSnap.exists) {
      throw new Error(`Order not found: ${orderId}`)
    }
    const order = orderSnap.data() as SalesOrder
    if (order.status !== 'quoted') {
      throw new Error(`Order status is '${order.status}', expected 'quoted'.`)
    }

    const itemLines = order.lines.filter((line) => line.itemId != null)
    const itemRefs = itemLines.map((line) => db.collection('stockItems').doc(line.itemId as string))
    const itemSnaps = await Promise.all(itemRefs.map((ref) => tx.get(ref)))

    itemSnaps.forEach((snap, i) => {
      const line = itemLines[i]
      if (!snap.exists) {
        throw new Error(`stockItem not found: ${line.itemId}`)
      }
      const item = snap.data() as StockItem
      if (item.status !== 'reserved') {
        throw new Error(`stockItem ${line.itemId} is '${item.status}', expected 'reserved'.`)
      }
    })

    itemLines.forEach((line, i) => {
      tx.update(itemRefs[i], { status: 'inStock' } satisfies WithFieldValue<Pick<StockItem, 'status'>>)

      const movementRef = db.collection('stockMovements').doc()
      const movement: WithFieldValue<StockMovement> = {
        movementId: movementRef.id,
        at: FieldValue.serverTimestamp(),
        type: 'release',
        skuCode: line.skuCode,
        itemId: line.itemId as string,
        qty: 1,
        unitCost: line.unitCost,
        ref: orderId,
        brand: 'mobisource',
        note,
      }
      tx.set(movementRef, movement)
    })

    tx.update(orderRef, { status: 'cancelled' } satisfies WithFieldValue<Pick<SalesOrder, 'status'>>)

    return { orderId, status: 'cancelled' as const }
  })
}
