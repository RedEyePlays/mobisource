import { initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import type { Firestore } from 'firebase-admin/firestore'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { receiveBulkShipment } from '../src/lib/receiveBulkShipment.js'
import { supplierSkuMapId } from '../src/lib/supplierSkuMapId.js'

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
const BATT_AFT = 'MS-BATT-IP14P-N-AFT'

async function seedSku(skuCode: string, overrides: Record<string, unknown> = {}) {
  await db.collection('skus').doc(skuCode).set({
    skuCode, partType: 'SCRN', model: MODEL, grade: 'N', source: 'AFT',
    trackingMode: 'bulk', expectedResale: 9000, listPriceRetail: 12000,
    listPriceTier1: 11000, listPriceTier2: 10500, listPriceTier3: 9500, active: true,
    ...overrides,
  })
}

async function countDocs(collection: string) {
  const snap = await db.collection(collection).get()
  return snap.size
}

describe('receiveBulkShipment', () => {
  it('receives a shipment with shipping included, computing landed cost and a weighted-average bulkStock', async () => {
    await seedSku(SCRN_AFT)
    await seedSku(BATT_AFT, { partType: 'BATT' })

    const result = await receiveBulkShipment(db, {
      supplier: 'Acme Parts',
      invoiceRef: 'INV-1001',
      fxRate: 1.35,
      shipping: { currency: 'USD', total: 10000 }, // $100.00 USD shipping
      lines: [
        { supplierSku: 'AC-SCRN-1', skuCode: SCRN_AFT, qty: 10, unitCostUSD: 5000 }, // $50.00/unit
        { supplierSku: 'AC-BATT-1', skuCode: BATT_AFT, qty: 5, unitCostUSD: 2000 }, // $20.00/unit
      ],
    })

    const receipt = (await db.collection('bulkReceipts').doc(result.receiptId).get()).data()!
    expect(receipt.shippingStatus).toBe('included')
    expect(receipt.shippingCurrency).toBe('USD')
    expect(receipt.shippingTotal).toBe(10000)
    expect(receipt.shippingTotalCAD).toBe(13500) // 10000 * 1.35

    // Shipping splits evenly per unit across all 15 units: 13500/15 = 900/unit.
    const scrnLine = receipt.lines.find((l: { skuCode: string }) => l.skuCode === SCRN_AFT)
    const battLine = receipt.lines.find((l: { skuCode: string }) => l.skuCode === BATT_AFT)
    expect(scrnLine.unitCostCAD).toBe(6750) // 5000 * 1.35
    expect(scrnLine.shippingAllocatedCAD).toBe(9000) // 900 * 10
    expect(scrnLine.landedCostCAD).toBe(7650) // 6750 + 900
    expect(battLine.unitCostCAD).toBe(2700) // 2000 * 1.35
    expect(battLine.shippingAllocatedCAD).toBe(4500) // 900 * 5
    expect(battLine.landedCostCAD).toBe(3600) // 2700 + 900

    const scrnStock = (await db.collection('bulkStock').doc(SCRN_AFT).get()).data()!
    expect(scrnStock.qtyOnHand).toBe(10)
    expect(scrnStock.avgLandedCost).toBe(7650)

    const movements = (await db.collection('stockMovements').where('ref', '==', result.receiptId).get()).docs.map(
      (d) => d.data(),
    )
    expect(movements).toHaveLength(2)
    const scrnMovement = movements.find((m) => m.skuCode === SCRN_AFT)!
    expect(scrnMovement).toMatchObject({ type: 'receive', qty: 10, unitCost: 7650, itemId: '' })
  })

  it('blends into existing bulkStock with a qty-weighted average', async () => {
    await seedSku(SCRN_AFT)
    await db.collection('bulkStock').doc(SCRN_AFT).set({
      skuCode: SCRN_AFT, qtyOnHand: 10, avgLandedCost: 6000, lastReceivedAt: new Date('2026-08-01'), reorderPoint: 5,
    })

    await receiveBulkShipment(db, {
      supplier: 'Acme Parts',
      invoiceRef: 'INV-1002',
      fxRate: 1.0,
      shipping: null,
      lines: [{ supplierSku: 'AC-SCRN-1', skuCode: SCRN_AFT, qty: 10, unitCostUSD: 8000 }],
    })

    // (10*6000 + 10*8000) / 20 = 7000
    const stock = (await db.collection('bulkStock').doc(SCRN_AFT).get()).data()!
    expect(stock.qtyOnHand).toBe(20)
    expect(stock.avgLandedCost).toBe(7000)
    // reorderPoint carries over from the existing doc, receiving never touches it.
    expect(stock.reorderPoint).toBe(5)
  })

  it('posts at unitCost only, with shippingStatus pending, when shipping is not yet known', async () => {
    await seedSku(SCRN_AFT)

    const result = await receiveBulkShipment(db, {
      supplier: 'Acme Parts',
      invoiceRef: 'INV-1003',
      fxRate: 1.4,
      shipping: null,
      lines: [{ supplierSku: 'AC-SCRN-1', skuCode: SCRN_AFT, qty: 4, unitCostUSD: 5000 }],
    })

    const receipt = (await db.collection('bulkReceipts').doc(result.receiptId).get()).data()!
    expect(receipt.shippingStatus).toBe('pending')
    expect(receipt.shippingTotal).toBeNull()
    expect(receipt.lines[0].shippingAllocatedCAD).toBe(0)
    expect(receipt.lines[0].landedCostCAD).toBe(7000) // 5000 * 1.4, no shipping yet

    const stock = (await db.collection('bulkStock').doc(SCRN_AFT).get()).data()!
    expect(stock.avgLandedCost).toBe(7000)
  })

  it('gives an oversized line its flat per-unit shipping override, spreading the rest across other lines', async () => {
    await seedSku(SCRN_AFT)
    await seedSku(BATT_AFT, { partType: 'BATT' })

    const result = await receiveBulkShipment(db, {
      supplier: 'Acme Parts',
      invoiceRef: 'INV-1004',
      fxRate: 1.0,
      shipping: { currency: 'CAD', total: 2000 },
      lines: [
        { supplierSku: 'AC-SCRN-1', skuCode: SCRN_AFT, qty: 10, unitCostUSD: 5000 },
        {
          supplierSku: 'AC-BATT-1',
          skuCode: BATT_AFT,
          qty: 2,
          unitCostUSD: 2000,
          shippingOverride: { currency: 'CAD', amount: 500 }, // oversized: $5.00/unit flat
        },
      ],
    })

    const receipt = (await db.collection('bulkReceipts').doc(result.receiptId).get()).data()!
    const battLine = receipt.lines.find((l: { skuCode: string }) => l.skuCode === BATT_AFT)
    const scrnLine = receipt.lines.find((l: { skuCode: string }) => l.skuCode === SCRN_AFT)
    expect(battLine.shippingAllocatedCAD).toBe(1000) // 500 * 2
    // Remaining 2000-1000=1000 across SCRN's 10 units = 100/unit.
    expect(scrnLine.shippingAllocatedCAD).toBe(1000)
    expect(scrnLine.landedCostCAD).toBe(5100)
  })

  it('auto-resolves a known supplierSku and upserts new supplierSkuMap entries', async () => {
    await seedSku(SCRN_AFT)

    await receiveBulkShipment(db, {
      supplier: 'Acme Parts',
      invoiceRef: 'INV-1005',
      fxRate: 1.0,
      shipping: null,
      lines: [{ supplierSku: 'AC-SCRN-1', skuCode: SCRN_AFT, qty: 1, unitCostUSD: 5000 }],
    })

    const mapId = supplierSkuMapId('Acme Parts', 'AC-SCRN-1')
    const mapping = (await db.collection('supplierSkuMap').doc(mapId).get()).data()!
    expect(mapping).toEqual({ supplier: 'Acme Parts', supplierSku: 'AC-SCRN-1', skuCode: SCRN_AFT })
  })

  it('rejects a skuCode that does not exist, with no writes', async () => {
    await expect(
      receiveBulkShipment(db, {
        supplier: 'Acme Parts',
        invoiceRef: 'INV-1006',
        fxRate: 1.0,
        shipping: null,
        lines: [{ supplierSku: 'AC-X', skuCode: 'MS-NOPE-IP14P-N-AFT', qty: 1, unitCostUSD: 1000 }],
      }),
    ).rejects.toThrow(/not found/)

    expect(await countDocs('bulkReceipts')).toBe(0)
    expect(await countDocs('bulkStock')).toBe(0)
    expect(await countDocs('stockMovements')).toBe(0)
  })

  it('rejects a skuCode that exists but is deactivated', async () => {
    await seedSku(SCRN_AFT, { active: false })

    await expect(
      receiveBulkShipment(db, {
        supplier: 'Acme Parts',
        invoiceRef: 'INV-1007',
        fxRate: 1.0,
        shipping: null,
        lines: [{ supplierSku: 'AC-SCRN-1', skuCode: SCRN_AFT, qty: 1, unitCostUSD: 1000 }],
      }),
    ).rejects.toThrow(/not an active SKU/)
  })

  it('rejects duplicate skuCodes within one receipt', async () => {
    await seedSku(SCRN_AFT)

    await expect(
      receiveBulkShipment(db, {
        supplier: 'Acme Parts',
        invoiceRef: 'INV-1008',
        fxRate: 1.0,
        shipping: null,
        lines: [
          { supplierSku: 'AC-SCRN-1', skuCode: SCRN_AFT, qty: 1, unitCostUSD: 1000 },
          { supplierSku: 'AC-SCRN-2', skuCode: SCRN_AFT, qty: 1, unitCostUSD: 1000 },
        ],
      }),
    ).rejects.toThrow(/Duplicate skuCode/)
  })
})
