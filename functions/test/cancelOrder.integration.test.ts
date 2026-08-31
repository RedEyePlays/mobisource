import { initializeApp } from 'firebase-admin/app'
import { getFirestore, Timestamp } from 'firebase-admin/firestore'
import type { Firestore } from 'firebase-admin/firestore'
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createOrder } from '../src/lib/createOrder.js'
import { confirmOrder } from '../src/lib/confirmOrder.js'
import { issueInvoice } from '../src/lib/issueInvoice.js'
import { cancelOrder } from '../src/lib/cancelOrder.js'
import { expireStaleQuotes } from '../src/lib/expireStaleQuotes.js'

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

describe('cancelOrder', () => {
  it('releases a reserved serialized item back to inStock and writes a release movement', async () => {
    await seedSku()
    await seedItem('item1')
    await seedBuyer('buyer1')
    const { orderId } = await createOrder(db, { buyerId: 'buyer1', itemIds: ['item1'] })

    const result = await cancelOrder(db, { orderId })
    expect(result.status).toBe('cancelled')

    const item = (await db.collection('stockItems').doc('item1').get()).data()!
    expect(item.status).toBe('inStock')

    const order = (await db.collection('salesOrders').doc(orderId).get()).data()!
    expect(order.status).toBe('cancelled')

    const movements = (await db.collection('stockMovements').where('ref', '==', orderId).get()).docs.map((d) =>
      d.data(),
    )
    expect(movements).toHaveLength(1)
    expect(movements[0]).toMatchObject({ type: 'release', skuCode: SCRN, itemId: 'item1', qty: 1, unitCost: 16925 })
  })

  it('does not touch bulkStock on cancel — a bulk line was never decremented at quote time', async () => {
    await seedBulkSku()
    await seedBulkStock(10, 1200)
    await seedBuyer('buyer1')
    const { orderId } = await createOrder(db, { buyerId: 'buyer1', bulkLines: [{ skuCode: BATT, qty: 4 }] })

    await cancelOrder(db, { orderId })

    const stock = (await db.collection('bulkStock').doc(BATT).get()).data()!
    expect(stock.qtyOnHand).toBe(10) // unchanged — nothing was ever held
    expect(await countDocs('stockMovements')).toBe(0) // no release movement for a line that was never reserved
  })

  it('rejects cancelling an already-confirmed order — a sale is reversed via a return, not a cancel', async () => {
    await seedSku()
    await seedItem('item1')
    await seedBuyer('buyer1')
    const { orderId } = await createOrder(db, { buyerId: 'buyer1', itemIds: ['item1'] })
    await confirmOrder(db, { orderId, paymentMethod: 'cash' })

    await expect(cancelOrder(db, { orderId })).rejects.toThrow(/quoted/)
  })

  it('rejects cancelling an already-cancelled order', async () => {
    await seedSku()
    await seedItem('item1')
    await seedBuyer('buyer1')
    const { orderId } = await createOrder(db, { buyerId: 'buyer1', itemIds: ['item1'] })
    await cancelOrder(db, { orderId })

    await expect(cancelOrder(db, { orderId })).rejects.toThrow(/quoted/)
  })

  it('rejects a nonexistent order', async () => {
    await expect(cancelOrder(db, { orderId: 'no-such-order' })).rejects.toThrow(/not found/)
  })

  it('refuses to issue an invoice for a cancelled order', async () => {
    await seedSku()
    await seedItem('item1')
    await seedBuyer('buyer1')
    const { orderId } = await createOrder(db, { buyerId: 'buyer1', itemIds: ['item1'] })
    await cancelOrder(db, { orderId })

    await expect(issueInvoice(db, { orderId })).rejects.toThrow(/cancelled/)
  })

  it('cancelling one order in a multi-item quote only releases that order\'s items', async () => {
    await seedSku()
    await seedItem('item1')
    await seedItem('item2')
    await seedBuyer('buyer1')
    const { orderId: order1 } = await createOrder(db, { buyerId: 'buyer1', itemIds: ['item1'] })
    const { orderId: order2 } = await createOrder(db, { buyerId: 'buyer1', itemIds: ['item2'] })

    await cancelOrder(db, { orderId: order1 })

    expect((await db.collection('stockItems').doc('item1').get()).data()!.status).toBe('inStock')
    expect((await db.collection('stockItems').doc('item2').get()).data()!.status).toBe('reserved')
  })
})

describe('expireStaleQuotes', () => {
  async function seedOldQuote(orderId: string, itemId: string, daysOld: number) {
    await seedItem(itemId, { status: 'reserved' })
    await db.collection('salesOrders').doc(orderId).set({
      orderId,
      buyerId: 'buyer1',
      lines: [{ skuCode: SCRN, itemId, qty: 1, unitPrice: 24000, unitCost: 16925 }],
      subtotal: 24000,
      tax: 3120,
      taxRateBps: 1300,
      taxStatus: 'taxable',
      total: 27120,
      status: 'quoted',
      createdAt: Timestamp.fromDate(new Date(Date.now() - daysOld * 24 * 60 * 60 * 1000)),
      paymentMethod: null,
    })
  }

  it('expires and releases a quote older than 7 days', async () => {
    await seedSku()
    await seedBuyer('buyer1')
    await seedOldQuote('old-order', 'old-item', 8)

    const result = await expireStaleQuotes(db)
    expect(result.expiredOrderIds).toEqual(['old-order'])

    const order = (await db.collection('salesOrders').doc('old-order').get()).data()!
    expect(order.status).toBe('cancelled')
    const item = (await db.collection('stockItems').doc('old-item').get()).data()!
    expect(item.status).toBe('inStock')

    const movements = (await db.collection('stockMovements').where('ref', '==', 'old-order').get()).docs.map((d) =>
      d.data(),
    )
    expect(movements[0]).toMatchObject({ type: 'release', note: 'auto-expired after 7 days' })
  })

  it('leaves a quote younger than 7 days alone', async () => {
    await seedSku()
    await seedBuyer('buyer1')
    await seedOldQuote('young-order', 'young-item', 3)

    const result = await expireStaleQuotes(db)
    expect(result.expiredOrderIds).toEqual([])
    expect((await db.collection('salesOrders').doc('young-order').get()).data()!.status).toBe('quoted')
    expect((await db.collection('stockItems').doc('young-item').get()).data()!.status).toBe('reserved')
  })

  it('treats exactly 7 days old as expired — the boundary is inclusive', async () => {
    await seedSku()
    await seedBuyer('buyer1')
    const asOf = new Date('2026-09-10T00:00:00Z')
    const exactlySevenDaysAgo = new Date(asOf.getTime() - 7 * 24 * 60 * 60 * 1000)
    await seedItem('boundary-item', { status: 'reserved' })
    await db.collection('salesOrders').doc('boundary-order').set({
      orderId: 'boundary-order',
      buyerId: 'buyer1',
      lines: [{ skuCode: SCRN, itemId: 'boundary-item', qty: 1, unitPrice: 24000, unitCost: 16925 }],
      subtotal: 24000,
      tax: 3120,
      taxRateBps: 1300,
      taxStatus: 'taxable',
      total: 27120,
      status: 'quoted',
      createdAt: Timestamp.fromDate(exactlySevenDaysAgo),
      paymentMethod: null,
    })

    const result = await expireStaleQuotes(db, { asOf })
    expect(result.expiredOrderIds).toEqual(['boundary-order'])
  })

  it('only expires quotes, never a confirmed/shipped/paid/cancelled order', async () => {
    await seedSku()
    await seedItem('item1')
    await seedBuyer('buyer1')
    const { orderId } = await createOrder(db, { buyerId: 'buyer1', itemIds: ['item1'] })
    await confirmOrder(db, { orderId, paymentMethod: 'cash' })
    await db.collection('salesOrders').doc(orderId).update({
      createdAt: Timestamp.fromDate(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)),
    })

    const result = await expireStaleQuotes(db)
    expect(result.expiredOrderIds).toEqual([])
    expect((await db.collection('salesOrders').doc(orderId).get()).data()!.status).toBe('confirmed')
  })

  it('sweeps multiple stale quotes in one call', async () => {
    await seedSku()
    await seedBuyer('buyer1')
    await seedOldQuote('order-a', 'item-a', 10)
    await seedOldQuote('order-b', 'item-b', 20)

    const result = await expireStaleQuotes(db)
    expect(result.expiredOrderIds.sort()).toEqual(['order-a', 'order-b'])
  })
})
