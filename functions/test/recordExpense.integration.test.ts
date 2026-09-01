import { initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import type { Firestore } from 'firebase-admin/firestore'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { recordExpense } from '../src/lib/recordExpense.js'

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

describe('recordExpense', () => {
  it('records an expense with HST paid', async () => {
    const result = await recordExpense(db, {
      date: '2026-08-15',
      description: 'Shop rent — August',
      amount: 250000,
      hstPaidCAD: 28761,
    })

    const expense = (await db.collection('expenses').doc(result.expenseId).get()).data()!
    expect(expense.description).toBe('Shop rent — August')
    expect(expense.amount).toBe(250000)
    expect(expense.hstPaidCAD).toBe(28761)
    expect(expense.date.toDate().toISOString().slice(0, 10)).toBe('2026-08-15')
  })

  it('defaults hstPaidCAD to 0 when omitted', async () => {
    const result = await recordExpense(db, { date: '2026-08-15', description: 'Bank fee', amount: 500 })
    const expense = (await db.collection('expenses').doc(result.expenseId).get()).data()!
    expect(expense.hstPaidCAD).toBe(0)
  })

  it('trims the description', async () => {
    const result = await recordExpense(db, { date: '2026-08-15', description: '  Supplies  ', amount: 1000 })
    const expense = (await db.collection('expenses').doc(result.expenseId).get()).data()!
    expect(expense.description).toBe('Supplies')
  })

  it('rejects a missing description', async () => {
    await expect(recordExpense(db, { date: '2026-08-15', amount: 1000 })).rejects.toThrow(/description/)
  })

  it('rejects an invalid date', async () => {
    await expect(
      recordExpense(db, { date: 'not-a-date', description: 'x', amount: 1000 }),
    ).rejects.toThrow(/date/)
  })

  it('rejects a negative amount', async () => {
    await expect(
      recordExpense(db, { date: '2026-08-15', description: 'x', amount: -1 }),
    ).rejects.toThrow(/amount/)
  })

  it('rejects hstPaidCAD greater than amount', async () => {
    await expect(
      recordExpense(db, { date: '2026-08-15', description: 'x', amount: 1000, hstPaidCAD: 1001 }),
    ).rejects.toThrow(/hstPaidCAD/)
  })
})
