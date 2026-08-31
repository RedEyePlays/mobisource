import { initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import type { Firestore } from 'firebase-admin/firestore'
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createOrder } from '../src/lib/createOrder.js'
import { confirmOrder } from '../src/lib/confirmOrder.js'
import { issueInvoice } from '../src/lib/issueInvoice.js'
import { processReturn } from '../src/lib/processReturn.js'

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

const SCRN = 'MS-SCRN-IP14P-A-PULL'
const BATT = 'MS-BATT-IP14P-N-AFT'

async function seedSku() {
  await db.collection('skus').doc(SCRN).set({
    skuCode: SCRN, partType: 'SCRN', model: 'IP14P', grade: 'A', source: 'PULL',
    trackingMode: 'serialized', expectedResale: 22000,
    listPriceRetail: 26000, listPriceTier1: 24000, listPriceTier2: 22500, listPriceTier3: 21000,
    active: true,
  })
}

async function seedItem(id: string, overrides: Record<string, unknown> = {}) {
  await db.collection('stockItems').doc(id).set({
    itemId: id,
    skuCode: SCRN,
    donorId: 'donor1',
    allocatedCost: 16925,
    grade: 'A',
    status: 'inStock',
    location: '',
    createdAt: new Date('2026-08-30'),
    soldPrice: null,
    soldDate: null,
    buyerId: '',
    ...overrides,
  })
}

async function seedBulkSku() {
  await db.collection('skus').doc(BATT).set({
    skuCode: BATT, partType: 'BATT', model: 'IP14P', grade: 'N', source: 'AFT',
    trackingMode: 'bulk', expectedResale: 1500,
    listPriceRetail: 2200, listPriceTier1: 2000, listPriceTier2: 1800, listPriceTier3: 1600,
    active: true,
  })
}

async function seedBulkStock(qtyOnHand: number, avgLandedCost = 1200) {
  await db.collection('bulkStock').doc(BATT).set({
    skuCode: BATT,
    qtyOnHand,
    avgLandedCost,
    lastReceivedAt: new Date('2026-08-30'),
    reorderPoint: 0,
  })
}

async function seedBuyer(id: string, overrides: Record<string, unknown> = {}) {
  await db.collection('buyers').doc(id).set({
    buyerId: id,
    name: 'Test Buyer',
    type: 'repairShop',
    tier: 'standard',
    terms: 'net15',
    contact: {},
    taxStatus: 'taxable',
    ...overrides,
  })
}

async function seedTaxConfig() {
  await db.collection('config').doc('tax').set({
    rates: [{ effectiveFrom: new Date('2010-07-01'), rateBps: 1300 }],
  })
}

async function seedBusinessConfig() {
  await db.collection('config').doc('business').set({
    legalName: 'MobiSource Inc.',
    address: '123 Repair Lane, Brampton, ON L6T 0A1',
    email: 'accounts@mobisource.example',
    phone: '(555) 555-0100',
    hstNumber: '123456789 RT0001',
  })
}

beforeEach(async () => {
  await seedTaxConfig()
  await seedBusinessConfig()
})

async function countDocs(collection: string) {
  const snap = await db.collection(collection).get()
  return snap.size
}

describe('processReturn', () => {
  it('restocks a returned serialized item at its original allocatedCost and credits the buyer', async () => {
    await seedSku()
    await seedItem('item1')
    await seedBuyer('buyer1')
    const { orderId } = await createOrder(db, { buyerId: 'buyer1', itemIds: ['item1'] })
    await confirmOrder(db, { orderId, paymentMethod: 'cash' })
    await issueInvoice(db, { orderId })

    const result = await processReturn(db, {
      orderId,
      lines: [{ skuCode: SCRN, itemId: 'item1', qty: 1, reason: 'DOA', disposition: 'restock' }],
    })

    expect(result.creditNoteNumber).toBe(1)
    expect(result.subtotal).toBe(24000)
    expect(result.tax).toBe(3120)
    expect(result.total).toBe(27120)

    const item = (await db.collection('stockItems').doc('item1').get()).data()!
    expect(item.status).toBe('inStock')
    expect(item.allocatedCost).toBe(16925) // unchanged — restocked at its original cost
    expect(item.soldPrice).toBeNull()

    const creditNote = (await db.collection('creditNotes').doc(result.returnId).get()).data()!
    expect(creditNote.creditNoteNumber).toBe(1)
    expect(creditNote.invoiceNumber).toBe(1)
    expect(creditNote.subtotal).toBe(24000)
    expect(creditNote.tax).toBe(3120)
    expect(creditNote.total).toBe(27120)
    expect(creditNote.lines).toEqual([
      { skuCode: SCRN, description: 'SCRN · IP14P · Grade A', qty: 1, unitPrice: 24000, lineTotal: 24000 },
    ])

    const movements = (await db.collection('stockMovements').where('type', '==', 'return').get()).docs.map((d) =>
      d.data(),
    )
    expect(movements).toHaveLength(1)
    expect(movements[0]).toMatchObject({ skuCode: SCRN, itemId: 'item1', qty: 1, unitCost: 16925, note: 'DOA / restock' })

    // The original sale movement is never touched.
    const saleMovements = (await db.collection('stockMovements').where('type', '==', 'sale').get()).docs
    expect(saleMovements).toHaveLength(1)
  })

  it('writes off a returned serialized item to status=returned, keeping soldPrice as history', async () => {
    await seedSku()
    await seedItem('item1')
    await seedBuyer('buyer1')
    const { orderId } = await createOrder(db, { buyerId: 'buyer1', itemIds: ['item1'] })
    await confirmOrder(db, { orderId, paymentMethod: 'cash' })
    await issueInvoice(db, { orderId })

    await processReturn(db, {
      orderId,
      lines: [{ skuCode: SCRN, itemId: 'item1', qty: 1, reason: 'wrongPart', disposition: 'writeOff' }],
    })

    const item = (await db.collection('stockItems').doc('item1').get()).data()!
    expect(item.status).toBe('returned')
    expect(item.soldPrice).toBe(24000) // kept as history, distinguishing this from a teardown scrap

    const movements = (await db.collection('stockMovements').where('type', '==', 'return').get()).docs.map((d) =>
      d.data(),
    )
    expect(movements).toHaveLength(1)
    expect(movements[0]).toMatchObject({ qty: 0, note: 'wrongPart / writeOff' })
  })

  it('restocks a bulk return, blending the returned qty into avgLandedCost at its original cost', async () => {
    await seedBulkSku()
    await seedBulkStock(10, 1200) // 10 on hand @ $12.00 after the sale below
    await seedBuyer('buyer1')
    const { orderId } = await createOrder(db, { buyerId: 'buyer1', bulkLines: [{ skuCode: BATT, qty: 4 }] })
    await confirmOrder(db, { orderId, paymentMethod: 'cash' })
    // 6 left on hand after the sale, still @ 1200 (a bulk sale never touches avgLandedCost)
    await issueInvoice(db, { orderId })

    await processReturn(db, {
      orderId,
      lines: [{ skuCode: BATT, qty: 2, reason: 'changedMind', disposition: 'restock' }],
    })

    const stock = (await db.collection('bulkStock').doc(BATT).get()).data()!
    // 6 on hand @ 1200 blended with 2 returned @ their original cost (1200, unchanged
    // since receiving never happened again) => still 1200; qtyOnHand back to 8.
    expect(stock.qtyOnHand).toBe(8)
    expect(stock.avgLandedCost).toBe(1200)

    const movements = (await db.collection('stockMovements').where('type', '==', 'return').get()).docs.map((d) =>
      d.data(),
    )
    expect(movements).toHaveLength(1)
    expect(movements[0]).toMatchObject({ skuCode: BATT, qty: 2, unitCost: 1200 })
  })

  it('blends a genuinely different original cost into avgLandedCost on bulk restock', async () => {
    await seedBulkSku()
    await seedBulkStock(10, 1000) // 10 on hand @ $10.00 when this sale happens
    await seedBuyer('buyer1')
    const { orderId } = await createOrder(db, { buyerId: 'buyer1', bulkLines: [{ skuCode: BATT, qty: 3 }] })
    await confirmOrder(db, { orderId, paymentMethod: 'cash' }) // unitCost snapshotted at 1000; 7 left on hand
    await issueInvoice(db, { orderId })

    // A later receiving landed at a higher cost, moving the average — simulated
    // directly here since receiveBulkShipment isn't what's under test.
    await db.collection('bulkStock').doc(BATT).update({ avgLandedCost: 1500 })

    await processReturn(db, {
      orderId,
      lines: [{ skuCode: BATT, qty: 2, reason: 'DOA', disposition: 'restock' }],
    })

    const stock = (await db.collection('bulkStock').doc(BATT).get()).data()!
    // 7 on hand @ 1500 blended with 2 returned units @ their *original* cost
    // (1000, from the order line snapshot) — not the current 1500:
    // round((7*1500 + 2*1000) / 9) = round(12500 / 9) = 1389
    expect(stock.qtyOnHand).toBe(9)
    expect(stock.avgLandedCost).toBe(1389)
  })

  it('writes off a bulk return without touching bulkStock', async () => {
    await seedBulkSku()
    await seedBulkStock(10, 1200)
    await seedBuyer('buyer1')
    const { orderId } = await createOrder(db, { buyerId: 'buyer1', bulkLines: [{ skuCode: BATT, qty: 4 }] })
    await confirmOrder(db, { orderId, paymentMethod: 'cash' })
    await issueInvoice(db, { orderId })

    await processReturn(db, {
      orderId,
      lines: [{ skuCode: BATT, qty: 2, reason: 'DOA', disposition: 'writeOff' }],
    })

    const stock = (await db.collection('bulkStock').doc(BATT).get()).data()!
    expect(stock.qtyOnHand).toBe(6) // unchanged by the write-off — still just 10 - 4 sold

    const movements = (await db.collection('stockMovements').where('type', '==', 'return').get()).docs.map((d) =>
      d.data(),
    )
    expect(movements[0]).toMatchObject({ qty: 0, unitCost: 1200 })
  })

  it('assigns sequential credit note numbers across different returns, separate from invoice numbers', async () => {
    await seedSku()
    await seedItem('item1')
    await seedItem('item2')
    await seedBuyer('buyer1')
    const { orderId: order1 } = await createOrder(db, { buyerId: 'buyer1', itemIds: ['item1'] })
    await confirmOrder(db, { orderId: order1, paymentMethod: 'cash' })
    await issueInvoice(db, { orderId: order1 })
    const { orderId: order2 } = await createOrder(db, { buyerId: 'buyer1', itemIds: ['item2'] })
    await confirmOrder(db, { orderId: order2, paymentMethod: 'cash' })
    await issueInvoice(db, { orderId: order2 })

    const return1 = await processReturn(db, {
      orderId: order1,
      lines: [{ skuCode: SCRN, itemId: 'item1', qty: 1, reason: 'DOA', disposition: 'restock' }],
    })
    const return2 = await processReturn(db, {
      orderId: order2,
      lines: [{ skuCode: SCRN, itemId: 'item2', qty: 1, reason: 'DOA', disposition: 'restock' }],
    })

    expect(return1.creditNoteNumber).toBe(1)
    expect(return2.creditNoteNumber).toBe(2)
  })

  it('charges $0 reversed tax for an exempt buyer, matching the frozen order', async () => {
    await seedSku()
    await seedItem('item1')
    await seedBuyer('buyer1', { taxStatus: 'exempt' })
    const { orderId } = await createOrder(db, { buyerId: 'buyer1', itemIds: ['item1'] })
    await confirmOrder(db, { orderId, paymentMethod: 'cash' })
    await issueInvoice(db, { orderId })

    const result = await processReturn(db, {
      orderId,
      lines: [{ skuCode: SCRN, itemId: 'item1', qty: 1, reason: 'DOA', disposition: 'restock' }],
    })

    expect(result.tax).toBe(0)
    expect(result.total).toBe(result.subtotal)
  })

  it('rejects returning more than was ever sold on that line', async () => {
    await seedBulkSku()
    await seedBulkStock(10, 1200)
    await seedBuyer('buyer1')
    const { orderId } = await createOrder(db, { buyerId: 'buyer1', bulkLines: [{ skuCode: BATT, qty: 3 }] })
    await confirmOrder(db, { orderId, paymentMethod: 'cash' })
    await issueInvoice(db, { orderId })

    await expect(
      processReturn(db, { orderId, lines: [{ skuCode: BATT, qty: 4, reason: 'DOA', disposition: 'restock' }] }),
    ).rejects.toThrow(/remain un-returned/)
  })

  it('rejects returning the same qty twice across two separate return events', async () => {
    await seedBulkSku()
    await seedBulkStock(10, 1200)
    await seedBuyer('buyer1')
    const { orderId } = await createOrder(db, { buyerId: 'buyer1', bulkLines: [{ skuCode: BATT, qty: 3 }] })
    await confirmOrder(db, { orderId, paymentMethod: 'cash' })
    await issueInvoice(db, { orderId })

    await processReturn(db, { orderId, lines: [{ skuCode: BATT, qty: 2, reason: 'DOA', disposition: 'restock' }] })
    // Only 1 remains un-returned — asking for 2 more should fail.
    await expect(
      processReturn(db, { orderId, lines: [{ skuCode: BATT, qty: 2, reason: 'DOA', disposition: 'restock' }] }),
    ).rejects.toThrow(/remain un-returned/)

    // But the 1 remaining unit can still be returned on its own.
    await processReturn(db, { orderId, lines: [{ skuCode: BATT, qty: 1, reason: 'DOA', disposition: 'restock' }] })
    const stock = (await db.collection('bulkStock').doc(BATT).get()).data()!
    expect(stock.qtyOnHand).toBe(10) // all 3 sold units are back
  })

  it('rejects a return against a still-quoted order', async () => {
    await seedSku()
    await seedItem('item1')
    await seedBuyer('buyer1')
    const { orderId } = await createOrder(db, { buyerId: 'buyer1', itemIds: ['item1'] })

    await expect(
      processReturn(db, { orderId, lines: [{ skuCode: SCRN, itemId: 'item1', qty: 1, reason: 'DOA', disposition: 'restock' }] }),
    ).rejects.toThrow(/quoted/)
  })

  it('rejects a return when no invoice has been issued for the order yet', async () => {
    await seedSku()
    await seedItem('item1')
    await seedBuyer('buyer1')
    const { orderId } = await createOrder(db, { buyerId: 'buyer1', itemIds: ['item1'] })
    await confirmOrder(db, { orderId, paymentMethod: 'cash' })

    await expect(
      processReturn(db, { orderId, lines: [{ skuCode: SCRN, itemId: 'item1', qty: 1, reason: 'DOA', disposition: 'restock' }] }),
    ).rejects.toThrow(/No invoice/)
  })

  it('rejects an unknown reason or disposition', async () => {
    await seedSku()
    await seedItem('item1')
    await seedBuyer('buyer1')
    const { orderId } = await createOrder(db, { buyerId: 'buyer1', itemIds: ['item1'] })
    await confirmOrder(db, { orderId, paymentMethod: 'cash' })
    await issueInvoice(db, { orderId })

    await expect(
      processReturn(db, { orderId, lines: [{ skuCode: SCRN, itemId: 'item1', qty: 1, reason: 'buyerRegret', disposition: 'restock' }] }),
    ).rejects.toThrow(/reason/)
    await expect(
      processReturn(db, { orderId, lines: [{ skuCode: SCRN, itemId: 'item1', qty: 1, reason: 'DOA', disposition: 'shred' }] }),
    ).rejects.toThrow(/disposition/)
  })

  it('never touches the original sale movement or the order doc', async () => {
    await seedSku()
    await seedItem('item1')
    await seedBuyer('buyer1')
    const { orderId } = await createOrder(db, { buyerId: 'buyer1', itemIds: ['item1'] })
    await confirmOrder(db, { orderId, paymentMethod: 'cash' })
    await issueInvoice(db, { orderId })
    const orderBefore = (await db.collection('salesOrders').doc(orderId).get()).data()!

    await processReturn(db, {
      orderId,
      lines: [{ skuCode: SCRN, itemId: 'item1', qty: 1, reason: 'DOA', disposition: 'restock' }],
    })

    const orderAfter = (await db.collection('salesOrders').doc(orderId).get()).data()!
    expect(orderAfter).toEqual(orderBefore)
    expect(await countDocs('stockMovements')).toBe(2) // the original sale + the new return
  })
})
