import type { Firestore, WithFieldValue } from 'firebase-admin/firestore'
import { FieldValue } from 'firebase-admin/firestore'
import { resolveLinePrice } from './resolveLinePrice.js'
import { calculateTax } from './calculateTax.js'
import { currentTaxRateBps } from './taxRate.js'
import { cents } from './types.js'
import type { BulkStock, Buyer, OrderLine, SalesOrder, Sku, StockItem, TaxConfig } from './types.js'

// ---------------------------------------------------------------------------
// Raw, untrusted shapes as they arrive from the client — unknown until
// validated below, matching teardownDonor's `parts: unknown` / receiving's
// `lines: unknown` convention (a wire value is never actually branded).
// ---------------------------------------------------------------------------

export interface CreateOrderInput {
  buyerId: string
  /** Serialized lines: one specific stockItem each, qty always 1. */
  itemIds?: unknown
  /** Bulk lines: a SKU + qty against bulkStock, no specific item. */
  bulkLines?: unknown
}

export interface CreateOrderResult {
  orderId: string
  subtotal: SalesOrder['subtotal']
  tax: SalesOrder['tax']
  taxRateBps: SalesOrder['taxRateBps']
  total: SalesOrder['total']
  lines: OrderLine[]
}

interface ParsedBulkLine {
  skuCode: string
  qty: number
}

function parseBulkLines(raw: unknown): ParsedBulkLine[] {
  if (raw == null) return []
  if (!Array.isArray(raw)) {
    throw new Error('bulkLines must be an array.')
  }
  const seen = new Set<string>()
  return raw.map((entry, i) => {
    const { skuCode, qty } = (entry ?? {}) as { skuCode?: unknown; qty?: unknown }
    if (typeof skuCode !== 'string' || !skuCode) {
      throw new Error(`bulkLines[${i}].skuCode is required.`)
    }
    if (seen.has(skuCode)) {
      throw new Error(`Duplicate skuCode in bulkLines: ${skuCode}`)
    }
    seen.add(skuCode)
    if (!Number.isInteger(qty) || (qty as number) <= 0) {
      throw new Error(`bulkLines[${i}].qty for ${skuCode} must be a positive integer.`)
    }
    return { skuCode, qty: qty as number }
  })
}

function parseItemIds(raw: unknown): string[] {
  if (raw == null) return []
  if (!Array.isArray(raw)) {
    throw new Error('itemIds must be an array.')
  }
  const ids = raw as string[]
  if (new Set(ids).size !== ids.length) {
    throw new Error('itemIds must not contain duplicates.')
  }
  return ids
}

/**
 * Quotes an order: resolves pricing server-side (the client never supplies
 * or sees a price) and, for serialized lines, reserves each stockItem so a
 * second, concurrent quote can't also claim it. Nothing is sold and no
 * stock is decremented yet — see confirmOrder.ts.
 *
 * A bulk line (docs/SCHEMA.md §3 salesOrders) only validates qty against
 * bulkStock.qtyOnHand here as a point-in-time, best-effort check — there's
 * no per-unit reservation for pooled stock the way there is for a specific
 * stockItem, so this can still be oversold by a second concurrent sale
 * between quote and confirm. confirmOrder re-validates and actually
 * decrements bulkStock, atomically with the ledger row, which is the only
 * place that check is authoritative.
 */
export async function createOrder(
  db: Firestore,
  { buyerId, itemIds, bulkLines }: CreateOrderInput,
): Promise<CreateOrderResult> {
  if (!buyerId) {
    throw new Error('buyerId is required.')
  }
  const ids = parseItemIds(itemIds)
  const bulk = parseBulkLines(bulkLines)
  if (ids.length === 0 && bulk.length === 0) {
    throw new Error('itemIds or bulkLines must include at least one line.')
  }

  const orderRef = db.collection('salesOrders').doc()

  return db.runTransaction(async (tx) => {
    const buyerRef = db.collection('buyers').doc(buyerId)
    const taxConfigRef = db.collection('config').doc('tax')
    const [buyerSnap, taxConfigSnap] = await Promise.all([tx.get(buyerRef), tx.get(taxConfigRef)])
    if (!buyerSnap.exists) {
      throw new Error(`Buyer not found: ${buyerId}`)
    }
    const buyer = buyerSnap.data() as Buyer

    const itemRefs = ids.map((id) => db.collection('stockItems').doc(id))
    const itemSnaps = await Promise.all(itemRefs.map((ref) => tx.get(ref)))

    const items = itemSnaps.map((snap, i) => {
      if (!snap.exists) {
        throw new Error(`stockItem not found: ${ids[i]}`)
      }
      const item = snap.data() as StockItem
      if (item.status !== 'inStock') {
        throw new Error(`stockItem ${ids[i]} is '${item.status}', expected 'inStock'.`)
      }
      return { ref: itemRefs[i], id: ids[i], ...item }
    })

    const itemSkuRefs = items.map((item) => db.collection('skus').doc(item.skuCode))
    const itemSkuSnaps = await Promise.all(itemSkuRefs.map((ref) => tx.get(ref)))

    const itemLines: OrderLine[] = items.map((item, i) => {
      if (!itemSkuSnaps[i].exists) {
        throw new Error(`SKU not found: ${item.skuCode}`)
      }
      const sku = itemSkuSnaps[i].data() as Sku
      const unitPrice = resolveLinePrice({ sku, buyer, qty: 1 })
      return {
        skuCode: item.skuCode,
        itemId: item.id,
        qty: 1,
        unitPrice,
        unitCost: item.allocatedCost,
      }
    })

    const bulkSkuRefs = bulk.map((line) => db.collection('skus').doc(line.skuCode))
    const bulkSkuSnaps = await Promise.all(bulkSkuRefs.map((ref) => tx.get(ref)))
    const bulkStockRefs = bulk.map((line) => db.collection('bulkStock').doc(line.skuCode))
    const bulkStockSnaps = await Promise.all(bulkStockRefs.map((ref) => tx.get(ref)))

    const bulkLinesOut: OrderLine[] = bulk.map((line, i) => {
      if (!bulkSkuSnaps[i].exists) {
        throw new Error(`SKU not found: ${line.skuCode}`)
      }
      const sku = bulkSkuSnaps[i].data() as Sku
      const stock = bulkStockSnaps[i].exists ? (bulkStockSnaps[i].data() as BulkStock) : null
      const qtyOnHand = stock?.qtyOnHand ?? 0
      if (qtyOnHand < line.qty) {
        throw new Error(`Not enough stock for ${line.skuCode}: have ${qtyOnHand}, need ${line.qty}.`)
      }
      const unitPrice = resolveLinePrice({ sku, buyer, qty: line.qty })
      return {
        skuCode: line.skuCode,
        qty: line.qty,
        unitPrice,
        unitCost: stock!.avgLandedCost,
      }
    })

    const lines = [...itemLines, ...bulkLinesOut]
    const subtotal = cents(lines.reduce((sum, line) => sum + line.unitPrice * line.qty, 0))

    // A preview only — confirmOrder recomputes and freezes the real tax at
    // confirm time, re-reading both the buyer's taxStatus and this config
    // fresh, since either may have changed by then. Shown here so a quote
    // under review (OrderBuilder) doesn't display a misleading $0 tax.
    if (!taxConfigSnap.exists) {
      throw new Error('config/tax is not set up.')
    }
    const taxConfig = taxConfigSnap.data() as TaxConfig
    const rateBps = currentTaxRateBps(
      taxConfig.rates.map((r) => ({ effectiveFrom: r.effectiveFrom.toDate(), rateBps: r.rateBps })),
      new Date(),
    )
    const { tax, appliedRateBps } = calculateTax({ subtotal, taxStatus: buyer.taxStatus ?? 'taxable', rateBps })
    const total = cents(subtotal + tax)

    const order: WithFieldValue<SalesOrder> = {
      orderId: orderRef.id,
      buyerId,
      lines,
      subtotal,
      tax,
      taxRateBps: appliedRateBps,
      taxStatus: buyer.taxStatus ?? 'taxable',
      total,
      status: 'quoted',
      createdAt: FieldValue.serverTimestamp(),
      paymentMethod: null,
    }
    tx.set(orderRef, order)

    for (const item of items) {
      tx.update(item.ref, { status: 'reserved' })
    }

    return { orderId: orderRef.id, subtotal, tax, taxRateBps: appliedRateBps, total, lines }
  })
}
