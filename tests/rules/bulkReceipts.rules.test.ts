import { readFileSync } from 'node:fs'
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from '@firebase/rules-unit-testing'
import type { RulesTestEnvironment } from '@firebase/rules-unit-testing'
import { doc, getDoc, setDoc } from 'firebase/firestore'
import { afterAll, afterEach, beforeAll, describe, it } from 'vitest'

let testEnv: RulesTestEnvironment

const RECEIPT_ID = 'receipt1'
const RECEIPT_DOC = {
  receiptId: RECEIPT_ID,
  supplier: 'Acme Parts',
  invoiceRef: 'INV-1001',
  fxRate: 1.37,
  receivedAt: new Date('2026-08-31'),
  shippingStatus: 'pending',
  shippingCurrency: null,
  shippingTotal: null,
  shippingTotalCAD: null,
  shippingAppliedAt: null,
  totalDiscrepancyCAD: 0,
  lines: [],
}

beforeAll(async () => {
  const [host, port] = (process.env.FIRESTORE_EMULATOR_HOST ?? '127.0.0.1:8080').split(':')

  testEnv = await initializeTestEnvironment({
    projectId: 'demo-mobisource',
    firestore: {
      rules: readFileSync('firestore.rules', 'utf8'),
      host,
      port: Number(port),
    },
  })
})

afterEach(async () => {
  await testEnv.clearFirestore()
})

afterAll(async () => {
  await testEnv.cleanup()
})

describe('bulkReceipts rules', () => {
  it('denies an unauthenticated read', async () => {
    const db = testEnv.unauthenticatedContext().firestore()
    await assertFails(getDoc(doc(db, `bulkReceipts/${RECEIPT_ID}`)))
  })

  it('denies a read from an authenticated non-staff client', async () => {
    const db = testEnv.authenticatedContext('user1').firestore()
    await assertFails(getDoc(doc(db, `bulkReceipts/${RECEIPT_ID}`)))
  })

  it('allows a read from an authenticated staff client', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), `bulkReceipts/${RECEIPT_ID}`), RECEIPT_DOC)
    })

    const db = testEnv.authenticatedContext('staff1', { staff: true }).firestore()
    await assertSucceeds(getDoc(doc(db, `bulkReceipts/${RECEIPT_ID}`)))
  })

  it('denies a write even from staff — receipts are only created/updated by the receiving callables', async () => {
    const db = testEnv.authenticatedContext('staff1', { staff: true }).firestore()
    await assertFails(setDoc(doc(db, `bulkReceipts/${RECEIPT_ID}`), RECEIPT_DOC))
  })
})
