import type { Firestore, WithFieldValue } from 'firebase-admin/firestore'
import { Timestamp } from 'firebase-admin/firestore'
import { cents } from './types.js'
import type { Buyer, BusinessConfig, Invoice, InvoiceCounter, InvoiceLine, SalesOrder, Sku } from './types.js'

export interface IssueInvoiceInput {
  orderId: string
}

/**
 * Issues an invoice for a confirmed sales order, or returns the existing one
 * unchanged if this order already has one — an invoice is a record, not a
 * view (docs/SCHEMA.md §12): once issued it never changes, and re-issuing
 * for the same order must never allocate a second invoice number.
 *
 * Doc ID = orderId (one confirmed order has exactly one invoice), which is
 * what makes re-issuing idempotent with a plain existence check rather than
 * needing a query. The invoice number itself comes from counters/invoices,
 * read-and-incremented inside this same transaction — a failed issuance
 * never consumes a number (nothing commits) and two concurrent issuances
 * for different orders can't collide (Firestore serializes the conflicting
 * transaction and retries it), so numbers are sequential and gap-free.
 */
export async function issueInvoice(db: Firestore, { orderId }: IssueInvoiceInput): Promise<Invoice> {
  if (!orderId) {
    throw new Error('orderId is required.')
  }

  const invoiceRef = db.collection('invoices').doc(orderId)

  return db.runTransaction(async (tx) => {
    const existingSnap = await tx.get(invoiceRef)
    if (existingSnap.exists) {
      return existingSnap.data() as Invoice
    }

    const orderRef = db.collection('salesOrders').doc(orderId)
    const orderSnap = await tx.get(orderRef)
    if (!orderSnap.exists) {
      throw new Error(`Order not found: ${orderId}`)
    }
    const order = orderSnap.data() as SalesOrder
    if (order.status === 'quoted') {
      throw new Error(`Order status is 'quoted' — an invoice can only be issued for a confirmed order.`)
    }

    const buyerRef = db.collection('buyers').doc(order.buyerId)
    const businessRef = db.collection('config').doc('business')
    const counterRef = db.collection('counters').doc('invoices')
    const skuRefs = order.lines.map((line) => db.collection('skus').doc(line.skuCode))

    const [buyerSnap, businessSnap, counterSnap, ...skuSnaps] = await Promise.all([
      tx.get(buyerRef),
      tx.get(businessRef),
      tx.get(counterRef),
      ...skuRefs.map((ref) => tx.get(ref)),
    ])

    if (!buyerSnap.exists) {
      throw new Error(`Buyer not found: ${order.buyerId}`)
    }
    if (!businessSnap.exists) {
      throw new Error('config/business is not set up.')
    }
    const buyer = buyerSnap.data() as Buyer
    const business = businessSnap.data() as BusinessConfig
    const lastNumber = counterSnap.exists ? (counterSnap.data() as InvoiceCounter).last : 0
    const invoiceNumber = lastNumber + 1

    const lines: InvoiceLine[] = order.lines.map((line, i) => {
      const skuSnap = skuSnaps[i]
      const sku = skuSnap.exists ? (skuSnap.data() as Sku) : null
      const description = sku ? `${sku.partType} · ${sku.model} · Grade ${sku.grade}` : line.skuCode
      return {
        skuCode: line.skuCode,
        description,
        qty: line.qty,
        unitPrice: line.unitPrice,
        lineTotal: cents(line.unitPrice * line.qty),
      }
    })

    // A concrete Timestamp (not FieldValue.serverTimestamp()) so the value
    // written and the value returned to the caller are identical — a
    // server-timestamp sentinel can't be read back within the same
    // transaction, and the PDF needs a real date immediately.
    const issuedAt = Timestamp.now()

    const invoice: WithFieldValue<Invoice> = {
      invoiceId: orderId,
      invoiceNumber,
      orderId,
      issuedAt,
      business,
      buyerName: buyer.name,
      buyerTerms: buyer.terms,
      lines,
      subtotal: order.subtotal,
      taxRateBps: order.taxRateBps,
      tax: order.tax,
      total: order.total,
    }
    tx.set(invoiceRef, invoice)

    const counter: WithFieldValue<InvoiceCounter> = { last: invoiceNumber }
    tx.set(counterRef, counter)

    return invoice as Invoice
  })
}
