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

const CREDIT_NOTE_DOC = {
  creditNoteId: 'return1',
  creditNoteNumber: 1,
  returnId: 'return1',
  orderId: 'order1',
  invoiceNumber: 1,
  issuedAt: new Date('2026-09-02'),
  business: { legalName: 'MobiSource Inc.', address: '', email: '', phone: '', hstNumber: '' },
  buyerName: 'Test Buyer',
  buyerTerms: 'net15',
  lines: [],
  subtotal: 0,
  taxRateBps: 1300,
  tax: 0,
  total: 0,
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

describe('creditNotes rules', () => {
  it('denies an unauthenticated read', async () => {
    const db = testEnv.unauthenticatedContext().firestore()
    await assertFails(getDoc(doc(db, 'creditNotes/return1')))
  })

  it('denies a read from an authenticated non-staff client', async () => {
    const db = testEnv.authenticatedContext('user1').firestore()
    await assertFails(getDoc(doc(db, 'creditNotes/return1')))
  })

  it('allows a read from an authenticated staff client', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'creditNotes/return1'), CREDIT_NOTE_DOC)
    })

    const db = testEnv.authenticatedContext('staff1', { staff: true }).firestore()
    await assertSucceeds(getDoc(doc(db, 'creditNotes/return1')))
  })

  it('denies a write even from staff — credit notes are only ever written by processReturn', async () => {
    const db = testEnv.authenticatedContext('staff1', { staff: true }).firestore()
    await assertFails(setDoc(doc(db, 'creditNotes/return1'), CREDIT_NOTE_DOC))
  })
})
