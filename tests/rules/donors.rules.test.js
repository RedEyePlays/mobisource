import { readFileSync } from 'node:fs'
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from '@firebase/rules-unit-testing'
import { doc, getDoc, setDoc } from 'firebase/firestore'
import { afterAll, afterEach, beforeAll, describe, it } from 'vitest'

let testEnv

const DONOR_ID = 'donor1'
const DONOR_DOC = {
  model: 'IP14P',
  imei: '123456789012345',
  purchaseCost: 40000,
  purchaseCurrency: 'CAD',
  fxRateUsed: null,
  purchaseDate: new Date('2026-08-01'),
  source: 'local',
  supplierRef: 'sup-1',
  condition: 'A',
  status: 'intact',
  notes: '',
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

describe('donors rules', () => {
  it('denies an unauthenticated read', async () => {
    const db = testEnv.unauthenticatedContext().firestore()
    await assertFails(getDoc(doc(db, `donors/${DONOR_ID}`)))
  })

  it('denies a read from an authenticated non-staff client', async () => {
    const db = testEnv.authenticatedContext('user1').firestore()
    await assertFails(getDoc(doc(db, `donors/${DONOR_ID}`)))
  })

  it('allows a read from an authenticated staff client, including purchaseCost', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), `donors/${DONOR_ID}`), DONOR_DOC)
    })

    const db = testEnv.authenticatedContext('staff1', { staff: true }).firestore()
    const snap = await assertSucceeds(getDoc(doc(db, `donors/${DONOR_ID}`)))
    if (snap.data().purchaseCost !== DONOR_DOC.purchaseCost) {
      throw new Error('expected staff read to include purchaseCost')
    }
  })

  it('denies a write even from staff — donors only change through the intake callable', async () => {
    const db = testEnv.authenticatedContext('staff1', { staff: true }).firestore()
    await assertFails(setDoc(doc(db, `donors/${DONOR_ID}`), DONOR_DOC))
  })
})
