import { initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import type { Firestore } from 'firebase-admin/firestore'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { adjustStock } from '../src/lib/adjustStock.js'

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

async function countDocs(collection: string) {
  const snap = await db.collection(collection).get()
  return snap.size
}

describe('adjustStock — itemId mode', () => {
  it('corrects a lost inStock item to scrapped, delta -1', async () => {
    await seedSku()
    await seedItem('item1', { status: 'inStock' })

    const result = await adjustStock(db, { itemId: 'item1', newStatus: 'scrapped', reason: 'Not on shelf during count' })

    expect(result).toMatchObject({ applied: true, delta: -1 })
    expect(result.movementIds).toHaveLength(1)
    const item = (await db.collection('stockItems').doc('item1').get()).data()!
    expect(item.status).toBe('scrapped')
    const movement = (await db.collection('stockMovements').doc(result.movementIds[0]).get()).data()!
    expect(movement).toMatchObject({ type: 'adjust', skuCode: SCRN, itemId: 'item1', qty: -1, unitCost: 16925 })
  })

  it('corrects an item wrongly marked sold back to inStock, delta +1', async () => {
    await seedSku()
    await seedItem('item1', { status: 'sold', soldPrice: 24000 })

    const result = await adjustStock(db, { itemId: 'item1', newStatus: 'inStock', reason: 'Found on shelf, never actually left' })

    expect(result).toMatchObject({ applied: true, delta: 1 })
    const item = (await db.collection('stockItems').doc('item1').get()).data()!
    expect(item.status).toBe('inStock')
  })

  it('gives delta 0 for a status change that does not cross the inStock boundary', async () => {
    await seedSku()
    await seedItem('item1', { status: 'sold', soldPrice: 24000 })

    const result = await adjustStock(db, { itemId: 'item1', newStatus: 'returned', reason: 'Correcting a mis-typed disposition' })

    expect(result).toMatchObject({ applied: true, delta: 0 })
  })

  it('is a no-op when the requested status matches the current one', async () => {
    await seedSku()
    await seedItem('item1', { status: 'inStock' })

    const result = await adjustStock(db, { itemId: 'item1', newStatus: 'inStock', reason: 'no change' })

    expect(result).toEqual({ applied: false, delta: 0, movementIds: [] })
    expect(await countDocs('stockMovements')).toBe(0)
  })

  it('rejects a nonexistent item', async () => {
    await expect(adjustStock(db, { itemId: 'no-such-item', newStatus: 'inStock', reason: 'x' })).rejects.toThrow(/not found/)
  })

  it('rejects an invalid newStatus', async () => {
    await seedSku()
    await seedItem('item1')
    await expect(adjustStock(db, { itemId: 'item1', newStatus: 'lost', reason: 'x' })).rejects.toThrow(/newStatus/)
  })
})

describe('adjustStock — skuCode mode, bulk', () => {
  it('increases qtyOnHand when more were physically counted, without touching avgLandedCost', async () => {
    await seedBulkSku()
    await seedBulkStock(10, 1200)

    const result = await adjustStock(db, { skuCode: BATT, newQty: 14, reason: 'Cycle count found more' })

    expect(result).toMatchObject({ applied: true, delta: 4 })
    const stock = (await db.collection('bulkStock').doc(BATT).get()).data()!
    expect(stock.qtyOnHand).toBe(14)
    expect(stock.avgLandedCost).toBe(1200)
    const movement = (await db.collection('stockMovements').doc(result.movementIds[0]).get()).data()!
    expect(movement).toMatchObject({ type: 'adjust', skuCode: BATT, qty: 4, unitCost: 1200 })
  })

  it('decreases qtyOnHand when fewer were physically counted', async () => {
    await seedBulkSku()
    await seedBulkStock(10, 1200)

    const result = await adjustStock(db, { skuCode: BATT, newQty: 6, reason: 'Cycle count found fewer' })

    expect(result).toMatchObject({ applied: true, delta: -4 })
    expect((await db.collection('bulkStock').doc(BATT).get()).data()!.qtyOnHand).toBe(6)
  })

  it('is a no-op when the count matches exactly', async () => {
    await seedBulkSku()
    await seedBulkStock(10, 1200)

    const result = await adjustStock(db, { skuCode: BATT, newQty: 10, reason: 'no variance' })

    expect(result).toEqual({ applied: false, delta: 0, movementIds: [] })
    expect(await countDocs('stockMovements')).toBe(0)
  })

  it('rejects a count against a bulk SKU with no bulkStock doc yet', async () => {
    await seedBulkSku()
    await expect(adjustStock(db, { skuCode: BATT, newQty: 5, reason: 'x' })).rejects.toThrow(/cost basis/)
  })
})

describe('adjustStock — skuCode mode, serialized', () => {
  it('writes off the shortfall when fewer serialized units were counted than tracked', async () => {
    await seedSku()
    await seedItem('item1')
    await seedItem('item2')
    await seedItem('item3')

    const result = await adjustStock(db, { skuCode: SCRN, newQty: 1, reason: 'Cycle count: only 1 on the shelf' })

    expect(result.applied).toBe(true)
    expect(result.delta).toBe(-2)
    expect(result.movementIds).toHaveLength(2)

    const items = await Promise.all(
      ['item1', 'item2', 'item3'].map(async (id) => (await db.collection('stockItems').doc(id).get()).data()!),
    )
    const statuses = items.map((i) => i.status).sort()
    expect(statuses).toEqual(['inStock', 'scrapped', 'scrapped'])
  })

  it('rejects counting more serialized units than are tracked as inStock', async () => {
    await seedSku()
    await seedItem('item1')

    await expect(
      adjustStock(db, { skuCode: SCRN, newQty: 3, reason: 'Found extra, unlabeled units' }),
    ).rejects.toThrow(/real source/)
  })

  it('is a no-op when the physical count matches the tracked inStock count', async () => {
    await seedSku()
    await seedItem('item1')
    await seedItem('item2')

    const result = await adjustStock(db, { skuCode: SCRN, newQty: 2, reason: 'no variance' })

    expect(result).toEqual({ applied: false, delta: 0, movementIds: [] })
  })

  it('only counts inStock items, not reserved/sold/scrapped ones, toward the tracked total', async () => {
    await seedSku()
    await seedItem('item1', { status: 'inStock' })
    await seedItem('item2', { status: 'reserved' })
    await seedItem('item3', { status: 'sold', soldPrice: 24000 })

    // Only item1 counts as inStock — counting 0 physically present writes it off.
    const result = await adjustStock(db, { skuCode: SCRN, newQty: 0, reason: 'none on shelf' })

    expect(result.delta).toBe(-1)
    expect((await db.collection('stockItems').doc('item1').get()).data()!.status).toBe('scrapped')
    expect((await db.collection('stockItems').doc('item2').get()).data()!.status).toBe('reserved')
  })
})

describe('adjustStock — input validation', () => {
  it('rejects when neither itemId nor skuCode is given', async () => {
    await expect(adjustStock(db, { reason: 'x' })).rejects.toThrow(/exactly one/)
  })

  it('rejects when both itemId and skuCode are given', async () => {
    await expect(adjustStock(db, { itemId: 'item1', skuCode: SCRN, newStatus: 'inStock', reason: 'x' })).rejects.toThrow(/exactly one/)
  })

  it('rejects a missing reason', async () => {
    await expect(adjustStock(db, { itemId: 'item1', newStatus: 'inStock' } as never)).rejects.toThrow(/reason/)
  })

  it('rejects a negative or non-integer newQty', async () => {
    await expect(adjustStock(db, { skuCode: SCRN, newQty: -1, reason: 'x' })).rejects.toThrow(/newQty/)
    await expect(adjustStock(db, { skuCode: SCRN, newQty: 1.5, reason: 'x' })).rejects.toThrow(/newQty/)
  })
})
