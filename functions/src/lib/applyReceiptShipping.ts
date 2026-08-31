import type { Firestore } from 'firebase-admin/firestore'
import { FieldValue } from 'firebase-admin/firestore'
import { allocateShipping } from './allocateShipping.js'
import { cents } from './types.js'
import type { BulkReceipt, BulkStock, Cents, PurchaseCurrency } from './types.js'

const CURRENCIES: readonly PurchaseCurrency[] = ['CAD', 'USD']

function isCurrency(value: unknown): value is PurchaseCurrency {
  return typeof value === 'string' && (CURRENCIES as readonly string[]).includes(value)
}

export interface ApplyShippingInput {
  currency?: unknown
  total?: unknown
}

export interface ApplyLineOverrideInput {
  skuCode?: unknown
  currency?: unknown
  amount?: unknown
}

export interface ApplyReceiptShippingInput {
  receiptId?: unknown
  shipping?: ApplyShippingInput
  lineOverrides?: unknown
}

interface ParsedOverride {
  skuCode: string
  currency: PurchaseCurrency
  amount: Cents
}

interface ParsedInput {
  receiptId: string
  shippingCurrency: PurchaseCurrency
  shippingTotal: Cents
  lineOverrides: ParsedOverride[]
}

function parseInput(input: ApplyReceiptShippingInput): ParsedInput {
  if (typeof input.receiptId !== 'string' || !input.receiptId) {
    throw new Error('receiptId is required.')
  }
  if (!isCurrency(input.shipping?.currency)) {
    throw new Error(`shipping currency must be one of ${CURRENCIES.join(', ')}.`)
  }
  if (!Number.isInteger(input.shipping?.total) || (input.shipping!.total as number) < 0) {
    throw new Error('shipping.total must be a non-negative integer (cents).')
  }

  const rawOverrides = (input.lineOverrides ?? []) as ApplyLineOverrideInput[]
  if (!Array.isArray(rawOverrides)) {
    throw new Error('lineOverrides must be an array.')
  }
  const lineOverrides: ParsedOverride[] = rawOverrides.map((override) => {
    if (typeof override.skuCode !== 'string' || !override.skuCode) {
      throw new Error('Each shipping override needs a skuCode.')
    }
    if (!isCurrency(override.currency)) {
      throw new Error(`shipping override currency for ${override.skuCode} must be one of ${CURRENCIES.join(', ')}.`)
    }
    if (!Number.isInteger(override.amount) || (override.amount as number) < 0) {
      throw new Error(`shipping override amount for ${override.skuCode} must be a non-negative integer (cents).`)
    }
    return { skuCode: override.skuCode, currency: override.currency, amount: cents(override.amount as number) }
  })

  return {
    receiptId: input.receiptId,
    shippingCurrency: input.shipping!.currency as PurchaseCurrency,
    shippingTotal: cents(input.shipping!.total as number),
    lineOverrides,
  }
}

function toCAD(amountCents: Cents, currency: PurchaseCurrency, fxRate: number): Cents {
  return currency === 'CAD' ? amountCents : cents(Math.round(amountCents * fxRate))
}

/**
 * Resolves shipping for a receipt posted with shippingStatus 'pending', per
 * docs/SCHEMA.md §7. Recomputes each line's shipping share and landed cost
 * using the same allocateShipping split as receiveBulkShipment, then blends
 * the increase into bulkStock's weighted-average landed cost — but only for
 * as many of the line's units as bulkStock still has on hand. Units already
 * sold keep the cost they were sold at; stockMovements (append-only) is
 * never touched here. The shipping cost attributable to already-sold units
 * is recorded on the receipt as a discrepancy instead of being absorbed
 * anywhere, so a late freight bill never restates historical margin.
 */
export async function applyReceiptShipping(
  db: Firestore,
  rawInput: ApplyReceiptShippingInput,
): Promise<{ receiptId: string; totalDiscrepancyCAD: Cents }> {
  const { receiptId, shippingCurrency, shippingTotal, lineOverrides } = parseInput(rawInput)
  const overrideByCode = new Map(lineOverrides.map((o) => [o.skuCode, o]))

  return db.runTransaction(async (tx) => {
    const receiptRef = db.collection('bulkReceipts').doc(receiptId)
    const receiptSnap = await tx.get(receiptRef)
    if (!receiptSnap.exists) {
      throw new Error(`Receipt not found: ${receiptId}`)
    }
    const receipt = receiptSnap.data() as BulkReceipt
    if (receipt.shippingStatus !== 'pending') {
      throw new Error(`Receipt shipping status is '${receipt.shippingStatus}', expected 'pending'.`)
    }

    const bulkStockRefs = receipt.lines.map((line) => db.collection('bulkStock').doc(line.skuCode))
    const bulkStockSnaps = await Promise.all(bulkStockRefs.map((ref) => tx.get(ref)))

    const shippingTotalCAD = toCAD(shippingTotal, shippingCurrency, receipt.fxRate)
    const overrideCADByCode = new Map<string, Cents>()
    for (const line of receipt.lines) {
      const override = overrideByCode.get(line.skuCode)
      if (override) {
        overrideCADByCode.set(line.skuCode, toCAD(override.amount, override.currency, receipt.fxRate))
      }
    }
    const allocations = allocateShipping(
      shippingTotalCAD,
      receipt.lines.map((line) => ({
        skuCode: line.skuCode,
        qty: line.qty,
        overrideCents: overrideCADByCode.get(line.skuCode) ?? null,
      })),
    )
    const shippingAllocatedByCode = new Map(allocations.map((a) => [a.skuCode, a.shippingAllocatedCents]))

    let totalDiscrepancyCAD = 0

    const newLines = receipt.lines.map((line, i) => {
      const shippingAllocatedCAD = shippingAllocatedByCode.get(line.skuCode) as Cents
      const deltaPerUnitCAD = Math.round(shippingAllocatedCAD / line.qty)
      const landedCostCAD = cents(line.unitCostCAD + deltaPerUnitCAD)

      const existingBulkStock = bulkStockSnaps[i].exists ? (bulkStockSnaps[i].data() as BulkStock) : null
      const unitsCorrected = Math.min(line.qty, existingBulkStock?.qtyOnHand ?? 0)
      const discrepancyCAD = cents((line.qty - unitsCorrected) * deltaPerUnitCAD)
      totalDiscrepancyCAD += discrepancyCAD

      if (existingBulkStock && unitsCorrected > 0) {
        const addedValue = unitsCorrected * deltaPerUnitCAD
        const newAvgLandedCost = cents(
          Math.round(
            (existingBulkStock.qtyOnHand * existingBulkStock.avgLandedCost + addedValue) /
              existingBulkStock.qtyOnHand,
          ),
        )
        tx.update(bulkStockRefs[i], { avgLandedCost: newAvgLandedCost })
      }

      const override = overrideByCode.get(line.skuCode)
      return {
        ...line,
        shippingOverrideCurrency: override?.currency ?? null,
        shippingOverrideAmount: override?.amount ?? null,
        shippingOverrideAmountCAD: override ? (overrideCADByCode.get(line.skuCode) as Cents) : null,
        shippingAllocatedCAD,
        landedCostCAD,
        unitsCorrected,
        discrepancyCAD,
      }
    })

    tx.update(receiptRef, {
      shippingStatus: 'applied',
      shippingCurrency,
      shippingTotal,
      shippingTotalCAD,
      shippingAppliedAt: FieldValue.serverTimestamp(),
      totalDiscrepancyCAD: cents(totalDiscrepancyCAD),
      lines: newLines,
    })

    return { receiptId, totalDiscrepancyCAD: cents(totalDiscrepancyCAD) }
  })
}
