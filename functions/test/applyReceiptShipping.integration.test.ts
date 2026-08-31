import { initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import type { Firestore } from 'firebase-admin/firestore'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { receiveBulkShipment } from '../src/lib/receiveBulkShipment.js'
import { applyReceiptShipping } from '../src/lib/applyReceiptShipping.js'

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  throw new Error('FIRESTORE_EMULATOR_HOST is not set — run this via `npm run test:integration`.')
}

let db: Firestore

beforeAll(() => {
  const app = initializeApp({ projectId: 'demo-mobisource' })
  db = getFirestore(app)
})

afterEach(async () => {
  const [host, port] = process.env.FIRESTORE_EMULATOR_HOST!.split(':')
  await fetch(
    `http://${host}:${port}/emulator/v1/projects/demo-mobisource/databases/(default)/documents`,
    { method: 'DELETE' },
  )
})

const MODEL = 'IP14P'
const SCRN_AFT = 'MS-SCRN-IP14P-N-AFT'

async function seedSku(skuCode: string) {
  await db.collection('skus').doc(skuCode).set({
    skuCode, partType: 'SCRN', model: MODEL, grade: 'N', source: 'AFT',
    trackingMode: 'bulk', expectedResale: 9000, listPriceRetail: 12000,
    listPriceTier1: 11000, listPriceTier2: 10500, listPriceTier3: 9500, active: true,
  })
}

describe('applyReceiptShipping', () => {
  it('recomputes landed cost and blends the correction into bulkStock when all units are still on hand', async () => {
    await seedSku(SCRN_AFT)
    const { receiptId } = await receiveBulkShipment(db, {
      supplier: 'Acme Parts',
      invoiceRef: 'INV-2001',
      fxRate: 1.0,
      shipping: null,
      lines: [{ supplierSku: 'AC-SCRN-1', skuCode: SCRN_AFT, qty: 10, unitCostUSD: 5000 }],
    })

    const result = await applyReceiptShipping(db, {
      receiptId,
      shipping: { currency: 'CAD', total: 1000 }, // $10.00 CAD / 10 units = $1.00/unit
    })

    expect(result.totalDiscrepancyCAD).toBe(0)

    const receipt = (await db.collection('bulkReceipts').doc(receiptId).get()).data()!
    expect(receipt.shippingStatus).toBe('applied')
    expect(receipt.lines[0].shippingAllocatedCAD).toBe(1000)
    expect(receipt.lines[0].landedCostCAD).toBe(5100) // 5000 + 1000/10
    expect(receipt.lines[0].unitsCorrected).toBe(10)
    expect(receipt.lines[0].discrepancyCAD).toBe(0)

    const stock = (await db.collection('bulkStock').doc(SCRN_AFT).get()).data()!
    expect(stock.avgLandedCost).toBe(5100)
    expect(stock.qtyOnHand).toBe(10) // quantity never changes when applying shipping
  })

  it('records a discrepancy for units already sold and leaves their recorded cost alone, per the receipt not restating historical margin', async () => {
    await seedSku(SCRN_AFT)
    const { receiptId } = await receiveBulkShipment(db, {
      supplier: 'Acme Parts',
      invoiceRef: 'INV-2002',
      fxRate: 1.0,
      shipping: null,
      lines: [{ supplierSku: 'AC-SCRN-1', skuCode: SCRN_AFT, qty: 10, unitCostUSD: 5000 }],
    })

    // Simulate 6 of the 10 units having already sold (a sale would decrement
    // bulkStock.qtyOnHand without touching avgLandedCost's basis for the
    // units that already left — that's the whole point of this test).
    await db.collection('bulkStock').doc(SCRN_AFT).update({ qtyOnHand: 4 })
    const preApplyMovementCount = (await db.collection('stockMovements').get()).size

    const result = await applyReceiptShipping(db, {
      receiptId,
      shipping: { currency: 'CAD', total: 1000 }, // $1.00/unit
    })

    // Only 4 of the 10 units are still on hand to absorb the correction;
    // the other 6 units' $1.00/unit share ($6.00) is an unabsorbed discrepancy.
    expect(result.totalDiscrepancyCAD).toBe(600)

    const receipt = (await db.collection('bulkReceipts').doc(receiptId).get()).data()!
    expect(receipt.lines[0].unitsCorrected).toBe(4)
    expect(receipt.lines[0].discrepancyCAD).toBe(600)
    expect(receipt.totalDiscrepancyCAD).toBe(600)

    // avgLandedCost blends the $1.00/unit correction into only the 4
    // remaining units: (4*5000 + 4*100) / 4 = 5100.
    const stock = (await db.collection('bulkStock').doc(SCRN_AFT).get()).data()!
    expect(stock.avgLandedCost).toBe(5100)
    expect(stock.qtyOnHand).toBe(4)

    // No new stockMovements row was written for the correction — the
    // ledger is append-only and this is a cost-only adjustment, not a
    // quantity change; the discrepancy lives on the receipt instead.
    expect((await db.collection('stockMovements').get()).size).toBe(preApplyMovementCount)
  })

  it('records the full line as a discrepancy when every unit has already left bulkStock', async () => {
    await seedSku(SCRN_AFT)
    const { receiptId } = await receiveBulkShipment(db, {
      supplier: 'Acme Parts',
      invoiceRef: 'INV-2003',
      fxRate: 1.0,
      shipping: null,
      lines: [{ supplierSku: 'AC-SCRN-1', skuCode: SCRN_AFT, qty: 10, unitCostUSD: 5000 }],
    })
    await db.collection('bulkStock').doc(SCRN_AFT).update({ qtyOnHand: 0 })

    const result = await applyReceiptShipping(db, { receiptId, shipping: { currency: 'CAD', total: 1000 } })

    expect(result.totalDiscrepancyCAD).toBe(1000)
    const receipt = (await db.collection('bulkReceipts').doc(receiptId).get()).data()!
    expect(receipt.lines[0].unitsCorrected).toBe(0)
    expect(receipt.lines[0].discrepancyCAD).toBe(1000)

    // avgLandedCost is untouched — nothing left to correct, dividing by a
    // zero qtyOnHand would be meaningless.
    const stock = (await db.collection('bulkStock').doc(SCRN_AFT).get()).data()!
    expect(stock.avgLandedCost).toBe(5000)
  })

  it('converts USD shipping using the receipt\'s own captured fxRate', async () => {
    await seedSku(SCRN_AFT)
    const { receiptId } = await receiveBulkShipment(db, {
      supplier: 'Acme Parts',
      invoiceRef: 'INV-2004',
      fxRate: 1.5,
      shipping: null,
      lines: [{ supplierSku: 'AC-SCRN-1', skuCode: SCRN_AFT, qty: 5, unitCostUSD: 5000 }],
    })

    await applyReceiptShipping(db, { receiptId, shipping: { currency: 'USD', total: 1000 } })

    const receipt = (await db.collection('bulkReceipts').doc(receiptId).get()).data()!
    expect(receipt.shippingTotalCAD).toBe(1500) // 1000 * 1.5
    expect(receipt.lines[0].shippingAllocatedCAD).toBe(1500)
  })

  it('rejects applying shipping twice', async () => {
    await seedSku(SCRN_AFT)
    const { receiptId } = await receiveBulkShipment(db, {
      supplier: 'Acme Parts',
      invoiceRef: 'INV-2005',
      fxRate: 1.0,
      shipping: null,
      lines: [{ supplierSku: 'AC-SCRN-1', skuCode: SCRN_AFT, qty: 5, unitCostUSD: 5000 }],
    })

    await applyReceiptShipping(db, { receiptId, shipping: { currency: 'CAD', total: 500 } })

    await expect(applyReceiptShipping(db, { receiptId, shipping: { currency: 'CAD', total: 500 } })).rejects.toThrow(
      /pending/,
    )
  })

  it('rejects applying shipping to a receipt that already included it', async () => {
    await seedSku(SCRN_AFT)
    const { receiptId } = await receiveBulkShipment(db, {
      supplier: 'Acme Parts',
      invoiceRef: 'INV-2006',
      fxRate: 1.0,
      shipping: { currency: 'CAD', total: 500 },
      lines: [{ supplierSku: 'AC-SCRN-1', skuCode: SCRN_AFT, qty: 5, unitCostUSD: 5000 }],
    })

    await expect(applyReceiptShipping(db, { receiptId, shipping: { currency: 'CAD', total: 500 } })).rejects.toThrow(
      /pending/,
    )
  })

  it('throws for a receipt that does not exist', async () => {
    await expect(
      applyReceiptShipping(db, { receiptId: 'no-such-receipt', shipping: { currency: 'CAD', total: 500 } }),
    ).rejects.toThrow(/not found/)
  })
})
