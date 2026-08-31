import { initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import type { Firestore } from 'firebase-admin/firestore'
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createOrder } from '../src/lib/createOrder.js'
import { confirmOrder } from '../src/lib/confirmOrder.js'

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

// createOrder and confirmOrder both require config/tax to exist (docs/SCHEMA.md
// §3) — seeded fresh before every test in this file, since the emulator is
// wiped after each one. Individual tests override this by re-seeding with
// different rates once a quote already exists.
async function seedTaxConfig(rates: { effectiveFrom: Date; rateBps: number }[] = [{ effectiveFrom: new Date('2010-07-01'), rateBps: 1300 }]) {
  await db.collection('config').doc('tax').set({ rates })
}

beforeEach(async () => {
  await seedTaxConfig()
})

const SCRN = 'MS-SCRN-IP14P-A-PULL'

// listPriceTier1=$240 (1-4u), listPriceTier2=$225 (5-19u), listPriceTier3=$210 (20+u), retail=$260
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

async function seedBuyer(id: string, overrides: Record<string, unknown> = {}) {
  await db.collection('buyers').doc(id).set({
    buyerId: id,
    name: 'Test Buyer',
    type: 'repairShop',
    tier: 'standard',
    terms: 'net15',
    contact: {},
    ...overrides,
  })
}

const BATT = 'MS-BATT-IP14P-N-AFT'

// listPriceTier1=$20 (1-4u), listPriceTier2=$18 (5-19u), listPriceTier3=$16 (20+u), retail=$22
async function seedBulkSku() {
  await db.collection('skus').doc(BATT).set({
    skuCode: BATT, partType: 'BATT', model: 'IP14P', grade: 'N', source: 'AFT',
    trackingMode: 'bulk', expectedResale: 1500,
    listPriceRetail: 2200, listPriceTier1: 2000, listPriceTier2: 1800, listPriceTier3: 1600,
    active: true,
  })
}

async function seedBulkStock(qtyOnHand: number, avgLandedCost = 1200, overrides: Record<string, unknown> = {}) {
  await db.collection('bulkStock').doc(BATT).set({
    skuCode: BATT,
    qtyOnHand,
    avgLandedCost,
    lastReceivedAt: new Date('2026-08-30'),
    reorderPoint: 0,
    ...overrides,
  })
}

async function countDocs(collection: string) {
  const snap = await db.collection(collection).get()
  return snap.size
}

describe('createOrder', () => {
  it('quotes a standard-tier buyer at the qty-1 (tier1) price and reserves the item', async () => {
    await seedSku()
    await seedItem('item1')
    await seedBuyer('buyer1', { tier: 'standard' })

    const result = await createOrder(db, { buyerId: 'buyer1', itemIds: ['item1'] })

    expect(result.lines).toEqual([
      { skuCode: SCRN, itemId: 'item1', qty: 1, unitPrice: 24000, unitCost: 16925 },
    ])
    expect(result.subtotal).toBe(24000)
    expect(result.taxRateBps).toBe(1300)
    expect(result.tax).toBe(3120) // 24000 * 1300 / 10000, buyer defaults to taxable
    expect(result.total).toBe(27120)

    const order = (await db.collection('salesOrders').doc(result.orderId).get()).data()!
    expect(order.status).toBe('quoted')
    expect(order).not.toHaveProperty('margin')
    expect(order).not.toHaveProperty('totalCost')

    const item = (await db.collection('stockItems').doc('item1').get()).data()!
    expect(item.status).toBe('reserved')
  })

  it('gives a partner-tier buyer their floor price even at qty 1 (below the 20+ bracket)', async () => {
    await seedSku()
    await seedItem('item1')
    await seedBuyer('buyer1', { tier: 'partner' })

    const result = await createOrder(db, { buyerId: 'buyer1', itemIds: ['item1'] })

    expect(result.lines[0].unitPrice).toBe(21000)
  })

  it('gives a retail buyer listPriceRetail regardless of tier', async () => {
    await seedSku()
    await seedItem('item1')
    await seedBuyer('buyer1', { type: 'retail', tier: 'partner' })

    const result = await createOrder(db, { buyerId: 'buyer1', itemIds: ['item1'] })

    expect(result.lines[0].unitPrice).toBe(26000)
  })

  it('rejects an item that is not inStock, with no order created and the item untouched', async () => {
    await seedSku()
    await seedItem('item1', { status: 'reserved' })
    await seedBuyer('buyer1')

    await expect(createOrder(db, { buyerId: 'buyer1', itemIds: ['item1'] })).rejects.toThrow(/inStock/)

    expect(await countDocs('salesOrders')).toBe(0)
    const item = (await db.collection('stockItems').doc('item1').get()).data()!
    expect(item.status).toBe('reserved')
  })

  it('rejects a nonexistent buyer', async () => {
    await seedSku()
    await seedItem('item1')

    await expect(createOrder(db, { buyerId: 'no-such-buyer', itemIds: ['item1'] })).rejects.toThrow(/not found/)
    expect(await countDocs('salesOrders')).toBe(0)
  })

  it('quotes a bulk line at the qty bracket price, omits itemId, and does not touch qtyOnHand', async () => {
    await seedBulkSku()
    await seedBulkStock(50, 1200)
    await seedBuyer('buyer1', { tier: 'standard' })

    const result = await createOrder(db, { buyerId: 'buyer1', bulkLines: [{ skuCode: BATT, qty: 6 }] })

    expect(result.lines).toEqual([{ skuCode: BATT, qty: 6, unitPrice: 1800, unitCost: 1200 }])
    expect(result.lines[0]).not.toHaveProperty('itemId')
    // subtotal is unitPrice * qty, not just unitPrice, once qty can exceed 1
    expect(result.subtotal).toBe(1800 * 6)

    const stock = (await db.collection('bulkStock').doc(BATT).get()).data()!
    expect(stock.qtyOnHand).toBe(50) // unchanged at quote time — only confirmOrder decrements it
  })

  it('quotes serialized and bulk lines together in one order', async () => {
    await seedSku()
    await seedItem('item1')
    await seedBulkSku()
    await seedBulkStock(10, 1200)
    await seedBuyer('buyer1', { tier: 'standard' })

    const result = await createOrder(db, {
      buyerId: 'buyer1',
      itemIds: ['item1'],
      bulkLines: [{ skuCode: BATT, qty: 2 }],
    })

    expect(result.lines).toHaveLength(2)
    expect(result.subtotal).toBe(24000 + 2000 * 2)
  })

  it('rejects a bulk line that asks for more than qtyOnHand, with no order created', async () => {
    await seedBulkSku()
    await seedBulkStock(3)
    await seedBuyer('buyer1')

    await expect(
      createOrder(db, { buyerId: 'buyer1', bulkLines: [{ skuCode: BATT, qty: 4 }] }),
    ).rejects.toThrow(/Not enough stock/)
    expect(await countDocs('salesOrders')).toBe(0)
  })

  it('rejects a bulk line for a SKU with no bulkStock doc at all', async () => {
    await seedBulkSku()
    await seedBuyer('buyer1')

    await expect(
      createOrder(db, { buyerId: 'buyer1', bulkLines: [{ skuCode: BATT, qty: 1 }] }),
    ).rejects.toThrow(/Not enough stock/)
  })

  it('rejects a request with neither itemIds nor bulkLines', async () => {
    await seedBuyer('buyer1')
    await expect(createOrder(db, { buyerId: 'buyer1' })).rejects.toThrow(/at least one line/)
  })

  it('rejects duplicate skuCodes within bulkLines', async () => {
    await seedBulkSku()
    await seedBulkStock(50)
    await seedBuyer('buyer1')

    await expect(
      createOrder(db, {
        buyerId: 'buyer1',
        bulkLines: [{ skuCode: BATT, qty: 1 }, { skuCode: BATT, qty: 2 }],
      }),
    ).rejects.toThrow(/Duplicate/)
  })
})

describe('confirmOrder', () => {
  it('flips items to sold, writes a sale movement per line, and confirms the order', async () => {
    await seedSku()
    await seedItem('item1')
    await seedBuyer('buyer1', { tier: 'standard' })
    const { orderId } = await createOrder(db, { buyerId: 'buyer1', itemIds: ['item1'] })

    const result = await confirmOrder(db, { orderId })
    expect(result.status).toBe('confirmed')

    const order = (await db.collection('salesOrders').doc(orderId).get()).data()!
    expect(order.status).toBe('confirmed')
    expect(order.confirmedAt).not.toBeNull()

    const item = (await db.collection('stockItems').doc('item1').get()).data()!
    expect(item.status).toBe('sold')
    expect(item.soldPrice).toBe(24000)
    expect(item.buyerId).toBe('buyer1')

    const movements = (await db.collection('stockMovements').where('ref', '==', orderId).get()).docs.map((d) =>
      d.data(),
    )
    expect(movements).toHaveLength(1)
    expect(movements[0]).toMatchObject({ type: 'sale', skuCode: SCRN, itemId: 'item1', qty: -1, unitCost: 16925 })
  })

  it('leaves confirmedAt null on a still-quoted order, and sets it only at confirm', async () => {
    await seedSku()
    await seedItem('item1')
    await seedBuyer('buyer1')
    const { orderId } = await createOrder(db, { buyerId: 'buyer1', itemIds: ['item1'] })

    const quoted = (await db.collection('salesOrders').doc(orderId).get()).data()!
    expect(quoted.confirmedAt).toBeNull()

    await confirmOrder(db, { orderId })

    const confirmed = (await db.collection('salesOrders').doc(orderId).get()).data()!
    expect(confirmed.confirmedAt).not.toBeNull()
  })

  it('rolls back entirely when confirmed twice — no partial writes on the second attempt', async () => {
    await seedSku()
    await seedItem('item1')
    await seedBuyer('buyer1')
    const { orderId } = await createOrder(db, { buyerId: 'buyer1', itemIds: ['item1'] })
    await confirmOrder(db, { orderId })

    const movementCountAfterFirst = await countDocs('stockMovements')

    await expect(confirmOrder(db, { orderId })).rejects.toThrow(/quoted/)

    expect(await countDocs('stockMovements')).toBe(movementCountAfterFirst)
    const item = (await db.collection('stockItems').doc('item1').get()).data()!
    expect(item.status).toBe('sold')
  })

  it('stores the payment method on confirm; leaves it null when omitted (on-account wholesale)', async () => {
    await seedSku()
    await seedItem('item1')
    await seedBuyer('buyer1')
    const { orderId: withPayment } = await createOrder(db, { buyerId: 'buyer1', itemIds: ['item1'] })
    await confirmOrder(db, { orderId: withPayment, paymentMethod: 'cash' })
    expect((await db.collection('salesOrders').doc(withPayment).get()).data()!.paymentMethod).toBe('cash')

    await seedItem('item2')
    const { orderId: noPayment } = await createOrder(db, { buyerId: 'buyer1', itemIds: ['item2'] })
    await confirmOrder(db, { orderId: noPayment })
    expect((await db.collection('salesOrders').doc(noPayment).get()).data()!.paymentMethod).toBeNull()
  })

  it('rejects an invalid payment method', async () => {
    await seedSku()
    await seedItem('item1')
    await seedBuyer('buyer1')
    const { orderId } = await createOrder(db, { buyerId: 'buyer1', itemIds: ['item1'] })

    await expect(confirmOrder(db, { orderId, paymentMethod: 'bitcoin' })).rejects.toThrow(/paymentMethod/)
  })

  it('decrements bulkStock.qtyOnHand and writes one sale movement per bulk line, atomically with confirm', async () => {
    await seedBulkSku()
    await seedBulkStock(50, 1200)
    await seedBuyer('buyer1')
    const { orderId } = await createOrder(db, { buyerId: 'buyer1', bulkLines: [{ skuCode: BATT, qty: 6 }] })

    await confirmOrder(db, { orderId, paymentMethod: 'card' })

    const stock = (await db.collection('bulkStock').doc(BATT).get()).data()!
    expect(stock.qtyOnHand).toBe(44)
    // avgLandedCost and reorderPoint are untouched by a sale — only qtyOnHand moves
    expect(stock.avgLandedCost).toBe(1200)

    const movements = (await db.collection('stockMovements').where('ref', '==', orderId).get()).docs.map((d) =>
      d.data(),
    )
    expect(movements).toHaveLength(1)
    expect(movements[0]).toMatchObject({ type: 'sale', skuCode: BATT, itemId: '', qty: -6, unitCost: 1200 })
  })

  it('re-validates bulk stock availability fresh at confirm time and rejects an oversold line', async () => {
    await seedBulkSku()
    await seedBulkStock(6, 1200)
    await seedBuyer('buyer1')
    // Two quotes both pass createOrder's point-in-time check (6 available, each asks for 5) —
    // this is exactly the race confirmOrder's fresh re-read is meant to catch.
    const { orderId: order1 } = await createOrder(db, { buyerId: 'buyer1', bulkLines: [{ skuCode: BATT, qty: 5 }] })
    const { orderId: order2 } = await createOrder(db, { buyerId: 'buyer1', bulkLines: [{ skuCode: BATT, qty: 5 }] })

    await confirmOrder(db, { orderId: order1 })
    expect((await db.collection('bulkStock').doc(BATT).get()).data()!.qtyOnHand).toBe(1)

    await expect(confirmOrder(db, { orderId: order2 })).rejects.toThrow(/Not enough stock/)

    // The failed confirm made no partial writes: stock unchanged, order still quoted.
    expect((await db.collection('bulkStock').doc(BATT).get()).data()!.qtyOnHand).toBe(1)
    expect((await db.collection('salesOrders').doc(order2).get()).data()!.status).toBe('quoted')
    expect(await countDocs('stockMovements')).toBe(1)
  })

  it('confirms mixed serialized + bulk lines in one transaction', async () => {
    await seedSku()
    await seedItem('item1')
    await seedBulkSku()
    await seedBulkStock(10, 1200)
    await seedBuyer('buyer1')
    const { orderId } = await createOrder(db, {
      buyerId: 'buyer1',
      itemIds: ['item1'],
      bulkLines: [{ skuCode: BATT, qty: 3 }],
    })

    await confirmOrder(db, { orderId, paymentMethod: 'eTransfer' })

    expect((await db.collection('stockItems').doc('item1').get()).data()!.status).toBe('sold')
    expect((await db.collection('bulkStock').doc(BATT).get()).data()!.qtyOnHand).toBe(7)
    expect(await countDocs('stockMovements')).toBe(2)
  })
})

describe('tax', () => {
  it('charges 13% HST on a taxable buyer, both at quote and at confirm', async () => {
    await seedSku()
    await seedItem('item1')
    await seedBuyer('buyer1', { taxStatus: 'taxable' })

    const quote = await createOrder(db, { buyerId: 'buyer1', itemIds: ['item1'] })
    expect(quote.subtotal).toBe(24000)
    expect(quote.taxRateBps).toBe(1300)
    expect(quote.tax).toBe(3120)

    const confirmed = await confirmOrder(db, { orderId: quote.orderId })
    expect(confirmed.taxRateBps).toBe(1300)
    expect(confirmed.tax).toBe(3120)
    expect(confirmed.total).toBe(27120)

    const order = (await db.collection('salesOrders').doc(quote.orderId).get()).data()!
    expect(order.tax).toBe(3120)
    expect(order.taxRateBps).toBe(1300)
    expect(order.taxStatus).toBe('taxable')
    expect(order.total).toBe(27120)
  })

  it('charges $0 tax for an exempt buyer', async () => {
    await seedSku()
    await seedItem('item1')
    await seedBuyer('buyer1', { taxStatus: 'exempt' })

    const quote = await createOrder(db, { buyerId: 'buyer1', itemIds: ['item1'] })
    expect(quote.tax).toBe(0)
    expect(quote.total).toBe(quote.subtotal)

    const confirmed = await confirmOrder(db, { orderId: quote.orderId })
    expect(confirmed.tax).toBe(0)
    expect(confirmed.total).toBe(confirmed.subtotal)
  })

  it('charges $0 tax for a zeroRated buyer', async () => {
    await seedSku()
    await seedItem('item1')
    await seedBuyer('buyer1', { taxStatus: 'zeroRated' })

    const quote = await createOrder(db, { buyerId: 'buyer1', itemIds: ['item1'] })
    expect(quote.tax).toBe(0)

    const confirmed = await confirmOrder(db, { orderId: quote.orderId })
    expect(confirmed.tax).toBe(0)
  })

  it('defaults a buyer with no taxStatus field at all to taxable', async () => {
    await seedSku()
    await seedItem('item1')
    // seedBuyer's base fixture has no taxStatus key — this is the shape of a
    // buyer doc written before this migration.
    await seedBuyer('buyer1')

    const quote = await createOrder(db, { buyerId: 'buyer1', itemIds: ['item1'] })
    expect(quote.tax).toBe(3120)

    const confirmed = await confirmOrder(db, { orderId: quote.orderId })
    expect(confirmed.tax).toBe(3120)
  })

  it("freezes tax on confirm — a later change to the buyer's taxStatus or to config/tax never touches an already-confirmed order", async () => {
    await seedSku()
    await seedItem('item1')
    await seedBuyer('buyer1', { taxStatus: 'taxable' })
    const quote = await createOrder(db, { buyerId: 'buyer1', itemIds: ['item1'] })
    await confirmOrder(db, { orderId: quote.orderId })

    // Both of these would change what a *new* order gets charged...
    await db.collection('buyers').doc('buyer1').update({ taxStatus: 'exempt' })
    await seedTaxConfig([
      { effectiveFrom: new Date('2010-07-01'), rateBps: 1300 },
      { effectiveFrom: new Date('2020-01-01'), rateBps: 1500 },
    ])

    // ...but never this already-confirmed order.
    const order = (await db.collection('salesOrders').doc(quote.orderId).get()).data()!
    expect(order.tax).toBe(3120)
    expect(order.taxRateBps).toBe(1300)
    expect(order.taxStatus).toBe('taxable')
    expect(order.total).toBe(27120)
  })

  it('rejects confirm when config/tax has no rate effective yet, even though the quote was made under a valid one', async () => {
    await seedSku()
    await seedItem('item1')
    await seedBuyer('buyer1')
    const quote = await createOrder(db, { buyerId: 'buyer1', itemIds: ['item1'] })

    // confirmOrder re-reads config/tax fresh rather than trusting the quote.
    await seedTaxConfig([{ effectiveFrom: new Date('2999-01-01'), rateBps: 1300 }])

    await expect(confirmOrder(db, { orderId: quote.orderId })).rejects.toThrow(/No tax rate/)
  })
})
