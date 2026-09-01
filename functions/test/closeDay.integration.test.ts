import { initializeApp } from 'firebase-admin/app'
import { getFirestore, Timestamp } from 'firebase-admin/firestore'
import type { Firestore } from 'firebase-admin/firestore'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { closeDay } from '../src/lib/closeDay.js'

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

// A generous one-day window in ms, matching what a browser would compute
// for local midnight-to-midnight.
const DAY_FROM = new Date('2026-08-31T04:00:00Z').getTime() // midnight Eastern (EDT, UTC-4)
const DAY_TO = new Date('2026-09-01T04:00:00Z').getTime()

let nextOrderId = 0
async function seedOrder(overrides: Record<string, unknown> = {}) {
  const orderId = `order-${nextOrderId++}`
  await db.collection('salesOrders').doc(orderId).set({
    orderId,
    buyerId: 'buyer1',
    lines: [],
    subtotal: 1000,
    tax: 130,
    taxRateBps: 1300,
    taxStatus: 'taxable',
    total: 1130,
    status: 'confirmed',
    createdAt: Timestamp.fromDate(new Date('2026-08-31T15:00:00Z')),
    confirmedAt: Timestamp.fromDate(new Date('2026-08-31T15:00:00Z')),
    paymentMethod: 'cash',
    ...overrides,
  })
  return orderId
}

describe('closeDay', () => {
  it('sums cash, card, and eTransfer orders confirmed within the window', async () => {
    await seedOrder({ paymentMethod: 'cash', total: 1000 })
    await seedOrder({ paymentMethod: 'cash', total: 500 })
    await seedOrder({ paymentMethod: 'card', total: 2000 })
    await seedOrder({ paymentMethod: 'eTransfer', total: 300 })

    const result = await closeDay(db, { date: '2026-08-31', fromMs: DAY_FROM, toMs: DAY_TO, countedCash: 1500 })

    expect(result.cashSalesTotal).toBe(1500)
    expect(result.cardSalesTotal).toBe(2000)
    expect(result.eTransferSalesTotal).toBe(300)
    expect(result.countedCash).toBe(1500)
    expect(result.cashVariance).toBe(0)

    const doc = (await db.collection('dailyCloses').doc('2026-08-31').get()).data()!
    expect(doc.cashSalesTotal).toBe(1500)
    expect(doc.closedAt).toBeDefined()
  })

  it('ignores an on-account order (null paymentMethod) in every bucket', async () => {
    await seedOrder({ paymentMethod: null, total: 5000 })
    await seedOrder({ paymentMethod: 'cash', total: 1000 })

    const result = await closeDay(db, { date: '2026-08-31', fromMs: DAY_FROM, toMs: DAY_TO, countedCash: 1000 })

    expect(result.cashSalesTotal).toBe(1000)
    expect(result.cardSalesTotal).toBe(0)
    expect(result.eTransferSalesTotal).toBe(0)
  })

  it('excludes an order confirmed before the window', async () => {
    await seedOrder({ paymentMethod: 'cash', total: 1000, confirmedAt: Timestamp.fromDate(new Date('2026-08-30T23:00:00Z')) })

    const result = await closeDay(db, { date: '2026-08-31', fromMs: DAY_FROM, toMs: DAY_TO, countedCash: 0 })
    expect(result.cashSalesTotal).toBe(0)
  })

  it('excludes an order confirmed after the window', async () => {
    await seedOrder({ paymentMethod: 'cash', total: 1000, confirmedAt: Timestamp.fromDate(new Date('2026-09-01T05:00:00Z')) })

    const result = await closeDay(db, { date: '2026-08-31', fromMs: DAY_FROM, toMs: DAY_TO, countedCash: 0 })
    expect(result.cashSalesTotal).toBe(0)
  })

  it('excludes a still-quoted order — it has no confirmedAt', async () => {
    await seedOrder({ status: 'quoted', paymentMethod: null, confirmedAt: null, total: 9000 })

    const result = await closeDay(db, { date: '2026-08-31', fromMs: DAY_FROM, toMs: DAY_TO, countedCash: 0 })
    expect(result.cashSalesTotal).toBe(0)
    expect(result.cardSalesTotal).toBe(0)
  })

  it('computes a negative variance when the drawer is short', async () => {
    await seedOrder({ paymentMethod: 'cash', total: 1000 })
    const result = await closeDay(db, { date: '2026-08-31', fromMs: DAY_FROM, toMs: DAY_TO, countedCash: 900 })
    expect(result.cashVariance).toBe(-100)
  })

  it('computes a positive variance when the drawer is over', async () => {
    await seedOrder({ paymentMethod: 'cash', total: 1000 })
    const result = await closeDay(db, { date: '2026-08-31', fromMs: DAY_FROM, toMs: DAY_TO, countedCash: 1200 })
    expect(result.cashVariance).toBe(200)
  })

  it('rejects closing the same date twice', async () => {
    await closeDay(db, { date: '2026-08-31', fromMs: DAY_FROM, toMs: DAY_TO, countedCash: 0 })
    await expect(
      closeDay(db, { date: '2026-08-31', fromMs: DAY_FROM, toMs: DAY_TO, countedCash: 0 }),
    ).rejects.toThrow(/already closed/)
  })

  it('rejects an invalid date format', async () => {
    await expect(
      closeDay(db, { date: '08/31/2026', fromMs: DAY_FROM, toMs: DAY_TO, countedCash: 0 }),
    ).rejects.toThrow(/date/)
  })

  it('rejects toMs not after fromMs', async () => {
    await expect(
      closeDay(db, { date: '2026-08-31', fromMs: DAY_TO, toMs: DAY_FROM, countedCash: 0 }),
    ).rejects.toThrow(/toMs/)
  })

  it('rejects a window that is far more than a day', async () => {
    await expect(
      closeDay(db, { date: '2026-08-31', fromMs: DAY_FROM, toMs: DAY_FROM + 5 * 24 * 60 * 60 * 1000, countedCash: 0 }),
    ).rejects.toThrow(/one day/)
  })

  it('rejects a negative countedCash', async () => {
    await expect(
      closeDay(db, { date: '2026-08-31', fromMs: DAY_FROM, toMs: DAY_TO, countedCash: -1 }),
    ).rejects.toThrow(/countedCash/)
  })
})
