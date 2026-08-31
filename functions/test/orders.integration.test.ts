import { initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import type { Firestore } from 'firebase-admin/firestore'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
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
    expect(result.tax).toBe(0)
    expect(result.total).toBe(24000)

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
})
