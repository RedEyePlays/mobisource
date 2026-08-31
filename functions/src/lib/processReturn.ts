import type { Firestore, WithFieldValue } from 'firebase-admin/firestore'
import { FieldValue, Timestamp } from 'firebase-admin/firestore'
import { calculateTax } from './calculateTax.js'
import { cents } from './types.js'
import type {
  BulkStock,
  CreditNote,
  CreditNoteCounter,
  CreditNoteLine,
  Invoice,
  Return,
  ReturnDisposition,
  ReturnLine,
  ReturnReason,
  SalesOrder,
  StockItem,
  StockMovement,
} from './types.js'

const REASONS: readonly ReturnReason[] = ['DOA', 'wrongPart', 'changedMind']
const DISPOSITIONS: readonly ReturnDisposition[] = ['restock', 'writeOff']
const REALIZED_ORDER_STATUSES = ['confirmed', 'shipped', 'paid']

export interface ProcessReturnInput {
  orderId: string
  lines: unknown
}

export interface ProcessReturnResult {
  returnId: string
  creditNoteNumber: number
  subtotal: Return['subtotal']
  tax: Return['tax']
  total: Return['total']
}

interface ParsedReturnLine {
  skuCode: string
  itemId?: string
  qty: number
  reason: ReturnReason
  disposition: ReturnDisposition
}

function parseReturnLines(raw: unknown): ParsedReturnLine[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new Error('lines must be a non-empty array.')
  }
  return raw.map((entry, i) => {
    const { skuCode, itemId, qty, reason, disposition } = (entry ?? {}) as Record<string, unknown>
    if (typeof skuCode !== 'string' || !skuCode) {
      throw new Error(`lines[${i}].skuCode is required.`)
    }
    if (itemId != null && typeof itemId !== 'string') {
      throw new Error(`lines[${i}].itemId must be a string.`)
    }
    if (!Number.isInteger(qty) || (qty as number) <= 0) {
      throw new Error(`lines[${i}].qty for ${skuCode} must be a positive integer.`)
    }
    if (!(REASONS as readonly string[]).includes(reason as string)) {
      throw new Error(`lines[${i}].reason must be one of ${REASONS.join(', ')}.`)
    }
    if (!(DISPOSITIONS as readonly string[]).includes(disposition as string)) {
      throw new Error(`lines[${i}].disposition must be one of ${DISPOSITIONS.join(', ')}.`)
    }
    return {
      skuCode,
      itemId: itemId as string | undefined,
      qty: qty as number,
      reason: reason as ReturnReason,
      disposition: disposition as ReturnDisposition,
    }
  })
}

function returnLineKey(line: { skuCode: string; itemId?: string }): string {
  return line.itemId ? `item:${line.itemId}` : `sku:${line.skuCode}`
}

/**
 * Processes a return against a confirmed order: validates each requested
 * line against what the order actually sold (and what's already been
 * returned, across possibly several prior return events on the same
 * order), restocks or writes off each unit, writes a `return` movement per
 * line, and issues a sequentially-numbered credit note reversing the
 * proportional tax — all in one transaction.
 *
 * Requires an invoice to already exist for the order (issueInvoice runs in
 * its own transaction, so it can't be nested here) — its business/buyer
 * snapshot and invoice number are reused directly on the credit note
 * rather than re-reading buyer/config, keeping the credit note consistent
 * with the invoice it reverses.
 */
export async function processReturn(
  db: Firestore,
  { orderId, lines: rawLines }: ProcessReturnInput,
): Promise<ProcessReturnResult> {
  if (!orderId) {
    throw new Error('orderId is required.')
  }
  const requested = parseReturnLines(rawLines)

  const returnRef = db.collection('returns').doc()

  return db.runTransaction(async (tx) => {
    const orderRef = db.collection('salesOrders').doc(orderId)
    const invoiceRef = db.collection('invoices').doc(orderId)
    const priorReturnsQuery = db.collection('returns').where('orderId', '==', orderId)
    const counterRef = db.collection('counters').doc('creditNotes')

    const [orderSnap, invoiceSnap, priorReturnsSnap, counterSnap] = await Promise.all([
      tx.get(orderRef),
      tx.get(invoiceRef),
      tx.get(priorReturnsQuery),
      tx.get(counterRef),
    ])

    if (!orderSnap.exists) {
      throw new Error(`Order not found: ${orderId}`)
    }
    const order = orderSnap.data() as SalesOrder
    if (!REALIZED_ORDER_STATUSES.includes(order.status)) {
      throw new Error(`Order status is '${order.status}' — a return can only be processed against a confirmed order.`)
    }
    if (!invoiceSnap.exists) {
      throw new Error('No invoice has been issued for this order yet — issue one before processing a return.')
    }
    const invoice = invoiceSnap.data() as Invoice

    const alreadyReturned = new Map<string, number>()
    for (const doc of priorReturnsSnap.docs) {
      const priorReturn = doc.data() as Return
      for (const line of priorReturn.lines) {
        const key = returnLineKey(line)
        alreadyReturned.set(key, (alreadyReturned.get(key) ?? 0) + line.qty)
      }
    }

    const orderLineByKey = new Map(order.lines.map((line) => [returnLineKey(line), line]))
    const invoiceDescByCode = new Map(invoice.lines.map((line) => [line.skuCode, line.description]))

    const resolved = requested.map((req) => {
      const key = returnLineKey(req)
      const orderLine = orderLineByKey.get(key)
      if (!orderLine) {
        throw new Error(`No such line on order ${orderId}: ${key}`)
      }
      const already = alreadyReturned.get(key) ?? 0
      if (already + req.qty > orderLine.qty) {
        throw new Error(
          `Cannot return ${req.qty} of ${key} — only ${orderLine.qty - already} of ${orderLine.qty} remain un-returned.`,
        )
      }
      return { ...req, orderLine }
    })

    // Reads needed before any writes: serialized stockItems (to restock or
    // write off) and bulkStock docs for a bulk restock (to blend the
    // returned qty's original cost into avgLandedCost).
    const itemRefs = resolved
      .filter((r) => r.itemId)
      .map((r) => ({ r, ref: db.collection('stockItems').doc(r.itemId as string) }))
    const itemSnaps = await Promise.all(itemRefs.map(({ ref }) => tx.get(ref)))

    const bulkRestocks = resolved.filter((r) => !r.itemId && r.disposition === 'restock')
    const bulkStockRefs = bulkRestocks.map((r) => db.collection('bulkStock').doc(r.skuCode))
    const bulkStockSnaps = await Promise.all(bulkStockRefs.map((ref) => tx.get(ref)))

    itemRefs.forEach(({ r }, i) => {
      const snap = itemSnaps[i]
      if (!snap.exists) {
        throw new Error(`stockItem not found: ${r.itemId}`)
      }
      const item = snap.data() as StockItem
      if (item.status !== 'sold') {
        throw new Error(`stockItem ${r.itemId} is '${item.status}', expected 'sold'.`)
      }
    })

    bulkRestocks.forEach((r, i) => {
      if (!bulkStockSnaps[i].exists) {
        throw new Error(`bulkStock not found: ${r.skuCode}`)
      }
    })

    const returnLines: ReturnLine[] = resolved.map((r) => ({
      skuCode: r.skuCode,
      ...(r.itemId ? { itemId: r.itemId } : {}),
      qty: r.qty,
      reason: r.reason,
      disposition: r.disposition,
      unitPrice: r.orderLine.unitPrice,
      unitCost: r.orderLine.unitCost,
    }))

    const subtotal = cents(returnLines.reduce((sum, line) => sum + line.unitPrice * line.qty, 0))
    const { tax } = calculateTax({ subtotal, taxStatus: order.taxStatus, rateBps: order.taxRateBps })
    const total = cents(subtotal + tax)

    const lastCreditNoteNumber = counterSnap.exists ? (counterSnap.data() as CreditNoteCounter).last : 0
    const creditNoteNumber = lastCreditNoteNumber + 1
    const issuedAt = Timestamp.now()

    const creditNoteLines: CreditNoteLine[] = returnLines.map((line) => ({
      skuCode: line.skuCode,
      description: invoiceDescByCode.get(line.skuCode) ?? line.skuCode,
      qty: line.qty,
      unitPrice: line.unitPrice,
      lineTotal: cents(line.unitPrice * line.qty),
    }))

    // --- Writes ---

    const returnDoc: WithFieldValue<Return> = {
      returnId: returnRef.id,
      orderId,
      lines: returnLines,
      subtotal,
      taxRateBps: order.taxRateBps,
      tax,
      total,
      createdAt: FieldValue.serverTimestamp(),
    }
    tx.set(returnRef, returnDoc)

    const creditNoteRef = db.collection('creditNotes').doc(returnRef.id)
    const creditNote: WithFieldValue<CreditNote> = {
      creditNoteId: returnRef.id,
      creditNoteNumber,
      returnId: returnRef.id,
      orderId,
      invoiceNumber: invoice.invoiceNumber,
      issuedAt,
      business: invoice.business,
      buyerName: invoice.buyerName,
      buyerTerms: invoice.buyerTerms,
      lines: creditNoteLines,
      subtotal,
      taxRateBps: order.taxRateBps,
      tax,
      total,
    }
    tx.set(creditNoteRef, creditNote)
    tx.set(counterRef, { last: creditNoteNumber } satisfies WithFieldValue<CreditNoteCounter>)

    itemRefs.forEach(({ r, ref }) => {
      if (r.disposition === 'restock') {
        const update: WithFieldValue<Pick<StockItem, 'status' | 'soldPrice' | 'soldDate' | 'buyerId'>> = {
          status: 'inStock',
          soldPrice: null,
          soldDate: null,
          buyerId: '',
        }
        tx.update(ref, update)
      } else {
        // Write-off: soldPrice/soldDate/buyerId stay as history, so the
        // margin report can tell this apart from a teardown 'scrapped'
        // item that was never sold (see marginBySku).
        tx.update(ref, { status: 'returned' } satisfies WithFieldValue<Pick<StockItem, 'status'>>)
      }

      const movementRef = db.collection('stockMovements').doc()
      const movement: WithFieldValue<StockMovement> = {
        movementId: movementRef.id,
        at: FieldValue.serverTimestamp(),
        type: 'return',
        skuCode: r.skuCode,
        itemId: r.itemId as string,
        qty: r.disposition === 'restock' ? 1 : 0,
        unitCost: r.orderLine.unitCost,
        ref: orderId,
        brand: 'mobisource',
        note: `${r.reason} / ${r.disposition}`,
      }
      tx.set(movementRef, movement)
    })

    bulkRestocks.forEach((r, i) => {
      const stock = bulkStockSnaps[i].data() as BulkStock
      const newQtyOnHand = stock.qtyOnHand + r.qty
      const blendedCost = cents(
        Math.round((stock.qtyOnHand * stock.avgLandedCost + r.qty * r.orderLine.unitCost) / newQtyOnHand),
      )
      tx.update(bulkStockRefs[i], { qtyOnHand: newQtyOnHand, avgLandedCost: blendedCost })

      const movementRef = db.collection('stockMovements').doc()
      const movement: WithFieldValue<StockMovement> = {
        movementId: movementRef.id,
        at: FieldValue.serverTimestamp(),
        type: 'return',
        skuCode: r.skuCode,
        itemId: '',
        qty: r.qty,
        unitCost: r.orderLine.unitCost,
        ref: orderId,
        brand: 'mobisource',
        note: `${r.reason} / ${r.disposition}`,
      }
      tx.set(movementRef, movement)
    })

    resolved
      .filter((r) => !r.itemId && r.disposition === 'writeOff')
      .forEach((r) => {
        const movementRef = db.collection('stockMovements').doc()
        const movement: WithFieldValue<StockMovement> = {
          movementId: movementRef.id,
          at: FieldValue.serverTimestamp(),
          type: 'return',
          skuCode: r.skuCode,
          itemId: '',
          qty: 0,
          unitCost: r.orderLine.unitCost,
          ref: orderId,
          brand: 'mobisource',
          note: `${r.reason} / ${r.disposition}`,
        }
        tx.set(movementRef, movement)
      })

    return { returnId: returnRef.id, creditNoteNumber, subtotal, tax, total }
  })
}
