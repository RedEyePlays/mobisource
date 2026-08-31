import type { Firestore, WithFieldValue } from 'firebase-admin/firestore'
import { FieldValue } from 'firebase-admin/firestore'
import type { BulkStock, PaymentMethod, SalesOrder, StockItem, StockMovement } from './types.js'

const PAYMENT_METHODS: readonly PaymentMethod[] = ['cash', 'card', 'eTransfer']

export interface ConfirmOrderInput {
  orderId: string
  /** Optional — a counter sale always sets this; an on-account wholesale order (confirmed via OrderBuilder) has no cash-register payment and leaves it null. */
  paymentMethod?: unknown
}

function parsePaymentMethod(raw: unknown): PaymentMethod | null {
  if (raw == null) return null
  if (typeof raw !== 'string' || !(PAYMENT_METHODS as readonly string[]).includes(raw)) {
    throw new Error(`paymentMethod must be one of ${PAYMENT_METHODS.join(', ')}.`)
  }
  return raw as PaymentMethod
}

/**
 * Confirms a quoted order atomically. For each line:
 * - a serialized line (itemId set) flips its stockItem to sold and writes a
 *   'sale' movement, as before.
 * - a bulk line (itemId omitted) re-reads bulkStock fresh in this same
 *   transaction, re-validates qty is still available (createOrder's check
 *   was only a point-in-time estimate — a second sale may have confirmed
 *   first), decrements qtyOnHand, and writes a 'sale' movement — the qty
 *   decrement and the ledger row land in the same transaction, so
 *   bulkStock never drifts from what stockMovements says happened.
 *
 * unitCost for a bulk line's movement is the value already snapshotted
 * onto the order at quote time (from bulkStock.avgLandedCost then), not
 * re-read here — same as a serialized line's unitCost, which was always a
 * quote-time snapshot of that item's allocatedCost. This keeps the order's
 * own stored unitCost and the movement's unitCost identical by
 * construction, at the cost of the recorded cost being "as of quote time"
 * rather than "as of this instant" if a receiving landed in between.
 *
 * If any assertion fails, everything queued above is discarded — nothing
 * commits.
 */
export async function confirmOrder(
  db: Firestore,
  { orderId, paymentMethod }: ConfirmOrderInput,
): Promise<{ orderId: string; status: 'confirmed' }> {
  if (!orderId) {
    throw new Error('orderId is required.')
  }
  const parsedPaymentMethod = parsePaymentMethod(paymentMethod)

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
    const bulkLines = order.lines.filter((line) => line.itemId == null)

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

    const bulkStockRefs = bulkLines.map((line) => db.collection('bulkStock').doc(line.skuCode))
    const bulkStockSnaps = await Promise.all(bulkStockRefs.map((ref) => tx.get(ref)))
    const newQtyOnHand = bulkStockSnaps.map((snap, i) => {
      const line = bulkLines[i]
      if (!snap.exists) {
        throw new Error(`bulkStock not found: ${line.skuCode}`)
      }
      const stock = snap.data() as BulkStock
      const remaining = stock.qtyOnHand - line.qty
      if (remaining < 0) {
        throw new Error(`Not enough stock for ${line.skuCode}: have ${stock.qtyOnHand}, need ${line.qty}.`)
      }
      return remaining
    })

    itemLines.forEach((line, i) => {
      const itemUpdate: WithFieldValue<Pick<StockItem, 'status' | 'soldPrice' | 'soldDate' | 'buyerId'>> = {
        status: 'sold',
        soldPrice: line.unitPrice,
        soldDate: FieldValue.serverTimestamp(),
        buyerId: order.buyerId,
      }
      tx.update(itemRefs[i], itemUpdate)

      const movementRef = db.collection('stockMovements').doc()
      const movement: WithFieldValue<StockMovement> = {
        movementId: movementRef.id,
        at: FieldValue.serverTimestamp(),
        type: 'sale',
        skuCode: line.skuCode,
        itemId: line.itemId as string,
        qty: -1,
        unitCost: line.unitCost,
        ref: orderId,
        brand: 'mobisource',
        note: '',
      }
      tx.set(movementRef, movement)
    })

    bulkLines.forEach((line, i) => {
      tx.update(bulkStockRefs[i], { qtyOnHand: newQtyOnHand[i] })

      const movementRef = db.collection('stockMovements').doc()
      const movement: WithFieldValue<StockMovement> = {
        movementId: movementRef.id,
        at: FieldValue.serverTimestamp(),
        type: 'sale',
        skuCode: line.skuCode,
        itemId: '',
        qty: -line.qty,
        unitCost: line.unitCost,
        ref: orderId,
        brand: 'mobisource',
        note: '',
      }
      tx.set(movementRef, movement)
    })

    tx.update(orderRef, { status: 'confirmed', paymentMethod: parsedPaymentMethod })

    return { orderId, status: 'confirmed' as const }
  })
}
