import type { Firestore, WithFieldValue } from 'firebase-admin/firestore'
import { FieldValue } from 'firebase-admin/firestore'
import { allocateShipping } from './allocateShipping.js'
import { supplierSkuMapId } from './supplierSkuMapId.js'
import { cents } from './types.js'
import type {
  BulkReceipt,
  BulkReceiptLine,
  BulkStock,
  Cents,
  PurchaseCurrency,
  Sku,
  StockMovement,
  SupplierSkuMap,
} from './types.js'

const CURRENCIES: readonly PurchaseCurrency[] = ['CAD', 'USD']

function isCurrency(value: unknown): value is PurchaseCurrency {
  return typeof value === 'string' && (CURRENCIES as readonly string[]).includes(value)
}

// ---------------------------------------------------------------------------
// Raw, untrusted shapes as they arrive from the client. Every field is
// unknown until validated below — matching teardownDonor's `parts: unknown`
// approach, since a Cents-branded field at the wire boundary would be a
// fiction: nothing on the wire is actually branded.
// ---------------------------------------------------------------------------

export interface ReceiveShippingInput {
  currency?: unknown
  total?: unknown
}

export interface ReceiveOverrideInput {
  currency?: unknown
  amount?: unknown
}

export interface ReceiveLineInput {
  supplierSku?: unknown
  skuCode?: unknown
  qty?: unknown
  unitCostUSD?: unknown
  shippingOverride?: ReceiveOverrideInput | null
}

export interface ReceiveBulkShipmentInput {
  supplier?: unknown
  invoiceRef?: unknown
  fxRate?: unknown
  /** Null means shipping isn't known yet — post now, apply it later via applyReceiptShipping. */
  shipping?: ReceiveShippingInput | null
  lines?: unknown
  /** HST actually paid on this shipment, in CAD cents — an input tax credit (docs/SCHEMA.md §17). Optional; defaults to 0 (most overseas aftermarket imports have none). */
  hstPaidCAD?: unknown
}

// ---------------------------------------------------------------------------
// Parsed, trustworthy shapes used by the rest of this module.
// ---------------------------------------------------------------------------

interface ParsedOverride {
  currency: PurchaseCurrency
  amount: Cents
}

interface ParsedLine {
  supplierSku: string
  skuCode: string
  qty: number
  unitCostUSD: Cents
  shippingOverride: ParsedOverride | null
}

interface ParsedShipping {
  currency: PurchaseCurrency
  total: Cents
}

interface ParsedInput {
  supplier: string
  invoiceRef: string
  fxRate: number
  shipping: ParsedShipping | null
  lines: ParsedLine[]
  hstPaidCAD: Cents
}

function parseCurrencyAmount(raw: ReceiveShippingInput | ReceiveOverrideInput, amountField: string, label: string): ParsedOverride {
  if (!isCurrency(raw.currency)) {
    throw new Error(`${label} currency must be one of ${CURRENCIES.join(', ')}.`)
  }
  const amount = (raw as Record<string, unknown>)[amountField]
  if (!Number.isInteger(amount) || (amount as number) < 0) {
    throw new Error(`${label} ${amountField} must be a non-negative integer (cents).`)
  }
  return { currency: raw.currency, amount: cents(amount as number) }
}

function parseInput(input: ReceiveBulkShipmentInput): ParsedInput {
  if (typeof input.supplier !== 'string' || !input.supplier.trim()) {
    throw new Error('supplier is required.')
  }
  if (typeof input.invoiceRef !== 'string' || !input.invoiceRef.trim()) {
    throw new Error('invoiceRef is required.')
  }
  if (!(typeof input.fxRate === 'number' && input.fxRate > 0)) {
    throw new Error('fxRate must be a positive number.')
  }
  if (!Array.isArray(input.lines) || input.lines.length === 0) {
    throw new Error('lines must be a non-empty array.')
  }

  const seenSkuCodes = new Set<string>()
  const lines: ParsedLine[] = (input.lines as ReceiveLineInput[]).map((line) => {
    if (typeof line.skuCode !== 'string' || !line.skuCode) {
      throw new Error(`skuCode is required for supplierSku ${String(line.supplierSku)}.`)
    }
    if (seenSkuCodes.has(line.skuCode)) {
      throw new Error(`Duplicate skuCode in lines: ${line.skuCode}`)
    }
    seenSkuCodes.add(line.skuCode)

    if (typeof line.supplierSku !== 'string' || !line.supplierSku.trim()) {
      throw new Error(`supplierSku is required for ${line.skuCode}.`)
    }
    if (!Number.isInteger(line.qty) || (line.qty as number) <= 0) {
      throw new Error(`qty for ${line.skuCode} must be a positive integer.`)
    }
    if (!Number.isInteger(line.unitCostUSD) || (line.unitCostUSD as number) < 0) {
      throw new Error(`unitCostUSD for ${line.skuCode} must be a non-negative integer (cents).`)
    }

    return {
      supplierSku: line.supplierSku,
      skuCode: line.skuCode,
      qty: line.qty as number,
      unitCostUSD: cents(line.unitCostUSD as number),
      shippingOverride: line.shippingOverride
        ? parseCurrencyAmount(line.shippingOverride, 'amount', `shippingOverride for ${line.skuCode}`)
        : null,
    }
  })

  const shipping = input.shipping ? parseCurrencyAmount(input.shipping, 'total', 'shipping') : null

  if (input.hstPaidCAD != null && (!Number.isInteger(input.hstPaidCAD) || (input.hstPaidCAD as number) < 0)) {
    throw new Error('hstPaidCAD must be a non-negative integer (cents).')
  }

  return {
    supplier: input.supplier,
    invoiceRef: input.invoiceRef,
    fxRate: input.fxRate,
    shipping: shipping ? { currency: shipping.currency, total: shipping.amount } : null,
    lines,
    hstPaidCAD: cents((input.hstPaidCAD as number) ?? 0),
  }
}

function toCAD(amountCents: Cents, currency: PurchaseCurrency, fxRate: number): Cents {
  return currency === 'CAD' ? amountCents : cents(Math.round(amountCents * fxRate))
}

/**
 * Receives a bulk shipment per docs/SCHEMA.md §7, atomically. `db` is a
 * Firestore instance (admin SDK) so this is callable directly from tests
 * against the emulator, without going through the onCall wrapper.
 *
 * Shipping is optional: pass null when the freight bill hasn't arrived yet.
 * The receipt posts at unitCost only (no shipping component) with
 * shippingStatus 'pending', and applyReceiptShipping resolves it later.
 */
export async function receiveBulkShipment(
  db: Firestore,
  rawInput: ReceiveBulkShipmentInput,
): Promise<{ receiptId: string }> {
  const { supplier, invoiceRef, fxRate, shipping, lines, hstPaidCAD } = parseInput(rawInput)

  const receiptRef = db.collection('bulkReceipts').doc()

  return db.runTransaction(async (tx) => {
    const skuRefs = lines.map((line) => db.collection('skus').doc(line.skuCode))
    const skuSnaps = await Promise.all(skuRefs.map((ref) => tx.get(ref)))
    const bulkStockRefs = lines.map((line) => db.collection('bulkStock').doc(line.skuCode))
    const bulkStockSnaps = await Promise.all(bulkStockRefs.map((ref) => tx.get(ref)))

    skuSnaps.forEach((snap, i) => {
      if (!snap.exists) {
        throw new Error(`SKU not found: ${lines[i].skuCode}`)
      }
      const sku = snap.data() as Sku
      if (!sku.active) {
        throw new Error(`${lines[i].skuCode} is not an active SKU.`)
      }
    })

    // Shipping allocation. Currency-normalize to CAD cents first (shipping
    // and its per-line overrides can each be billed in either currency),
    // then hand the currency-agnostic split to allocateShipping.
    let shippingTotalCAD: Cents | null = null
    let shippingAllocatedByCode = new Map<string, Cents>()
    if (shipping) {
      shippingTotalCAD = toCAD(shipping.total, shipping.currency, fxRate)
      const overrideCADByCode = new Map<string, Cents>()
      for (const line of lines) {
        if (line.shippingOverride) {
          overrideCADByCode.set(line.skuCode, toCAD(line.shippingOverride.amount, line.shippingOverride.currency, fxRate))
        }
      }
      const allocations = allocateShipping(
        shippingTotalCAD,
        lines.map((line) => ({
          skuCode: line.skuCode,
          qty: line.qty,
          overrideCents: overrideCADByCode.get(line.skuCode) ?? null,
        })),
      )
      shippingAllocatedByCode = new Map(allocations.map((a) => [a.skuCode, a.shippingAllocatedCents]))
    }

    const receiptLines: BulkReceiptLine[] = []

    lines.forEach((line, i) => {
      const unitCostCAD = cents(Math.round(line.unitCostUSD * fxRate))
      const shippingAllocatedCAD = shippingAllocatedByCode.get(line.skuCode) ?? cents(0)
      const landedCostCAD = cents(unitCostCAD + Math.round(shippingAllocatedCAD / line.qty))

      const overrideCurrency = line.shippingOverride?.currency ?? null
      const overrideAmount = line.shippingOverride?.amount ?? null
      const overrideAmountCAD = line.shippingOverride
        ? toCAD(line.shippingOverride.amount, line.shippingOverride.currency, fxRate)
        : null

      receiptLines.push({
        skuCode: line.skuCode,
        supplierSku: line.supplierSku,
        qty: line.qty,
        unitCostUSD: line.unitCostUSD,
        unitCostCAD,
        shippingOverrideCurrency: overrideCurrency,
        shippingOverrideAmount: overrideAmount,
        shippingOverrideAmountCAD: overrideAmountCAD,
        shippingAllocatedCAD,
        landedCostCAD,
        unitsCorrected: null,
        discrepancyCAD: null,
      })

      const mapRef = db.collection('supplierSkuMap').doc(supplierSkuMapId(supplier, line.supplierSku))
      const mapping: WithFieldValue<SupplierSkuMap> = {
        supplier,
        supplierSku: line.supplierSku,
        skuCode: line.skuCode,
      }
      tx.set(mapRef, mapping)

      const existingBulkStock = bulkStockSnaps[i].exists ? (bulkStockSnaps[i].data() as BulkStock) : null
      const newQtyOnHand = (existingBulkStock?.qtyOnHand ?? 0) + line.qty
      const newAvgLandedCost = existingBulkStock
        ? cents(
            Math.round(
              (existingBulkStock.qtyOnHand * existingBulkStock.avgLandedCost + line.qty * landedCostCAD) /
                newQtyOnHand,
            ),
          )
        : landedCostCAD
      const bulkStock: WithFieldValue<BulkStock> = {
        skuCode: line.skuCode,
        qtyOnHand: newQtyOnHand,
        avgLandedCost: newAvgLandedCost,
        lastReceivedAt: FieldValue.serverTimestamp(),
        reorderPoint: existingBulkStock?.reorderPoint ?? 0,
      }
      tx.set(bulkStockRefs[i], bulkStock)

      const movementRef = db.collection('stockMovements').doc()
      const movement: WithFieldValue<StockMovement> = {
        movementId: movementRef.id,
        at: FieldValue.serverTimestamp(),
        type: 'receive',
        skuCode: line.skuCode,
        itemId: '',
        qty: line.qty,
        unitCost: landedCostCAD,
        ref: receiptRef.id,
        brand: 'mobisource',
        note: '',
      }
      tx.set(movementRef, movement)
    })

    const receipt: WithFieldValue<BulkReceipt> = {
      receiptId: receiptRef.id,
      supplier,
      invoiceRef,
      fxRate,
      receivedAt: FieldValue.serverTimestamp(),
      shippingStatus: shipping ? 'included' : 'pending',
      shippingCurrency: shipping?.currency ?? null,
      shippingTotal: shipping?.total ?? null,
      shippingTotalCAD,
      shippingAppliedAt: null,
      totalDiscrepancyCAD: cents(0),
      hstPaidCAD,
      lines: receiptLines,
    }
    tx.set(receiptRef, receipt)

    return { receiptId: receiptRef.id }
  })
}
