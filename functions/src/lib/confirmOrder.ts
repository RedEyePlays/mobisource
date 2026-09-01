import type { Firestore, WithFieldValue } from 'firebase-admin/firestore'
import { FieldValue } from 'firebase-admin/firestore'
import { calculateTax } from './calculateTax.js'
import { currentTaxRateBps } from './taxRate.js'
import { cents } from './types.js'
import type { Buyer, BulkStock, PaymentMethod, SalesOrder, StockItem, StockMovement, TaxConfig } from './types.js'

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
export interface ConfirmOrderResult {
  orderId: string
  status: 'confirmed'
  subtotal: SalesOrder['subtotal']
  tax: SalesOrder['tax']
  taxRateBps: SalesOrder['taxRateBps']
  total: SalesOrder['total']
}

export async function confirmOrder(
  db: Firestore,
  { orderId, paymentMethod }: ConfirmOrderInput,
): Promise<ConfirmOrderResult> {
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

    // Tax is calculated here, at confirm — not carried over from the quote
    // — and re-reads both the buyer's taxStatus and the rate config fresh,
    // since either could have changed while this quote sat around. Once
    // written below, it's never recomputed again: a past order's tax must
    // never move (docs/SCHEMA.md §3), even if the buyer's status or the
    // configured rate changes afterward.
    const buyerRef = db.collection('buyers').doc(order.buyerId)
    const taxConfigRef = db.collection('config').doc('tax')
    const [buyerSnap, taxConfigSnap] = await Promise.all([tx.get(buyerRef), tx.get(taxConfigRef)])
    if (!buyerSnap.exists) {
      throw new Error(`Buyer not found: ${order.buyerId}`)
    }
    if (!taxConfigSnap.exists) {
      throw new Error('config/tax is not set up.')
    }
    const buyer = buyerSnap.data() as Buyer
    const taxConfig = taxConfigSnap.data() as TaxConfig
    const rateBps = currentTaxRateBps(
      taxConfig.rates.map((r) => ({ effectiveFrom: r.effectiveFrom.toDate(), rateBps: r.rateBps })),
      new Date(),
    )
    const taxStatus = buyer.taxStatus ?? 'taxable'
    const { tax, appliedRateBps } = calculateTax({ subtotal: order.subtotal, taxStatus, rateBps })
    const total = cents(order.subtotal + tax)

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

    tx.update(orderRef, {
      status: 'confirmed',
      paymentMethod: parsedPaymentMethod,
      tax,
      taxRateBps: appliedRateBps,
      taxStatus,
      total,
      confirmedAt: FieldValue.serverTimestamp(),
    })

    return { orderId, status: 'confirmed' as const, subtotal: order.subtotal, tax, taxRateBps: appliedRateBps, total }
  })
}
