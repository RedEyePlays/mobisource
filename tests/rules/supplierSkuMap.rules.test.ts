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

const MAP_ID = 'acme-parts__ac-1234'
const MAP_DOC = {
  supplier: 'Acme Parts',
  supplierSku: 'AC-1234',
  skuCode: 'MS-BATT-IP14P-N-AFT',
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

describe('supplierSkuMap rules', () => {
  it('denies an unauthenticated read', async () => {
    const db = testEnv.unauthenticatedContext().firestore()
    await assertFails(getDoc(doc(db, `supplierSkuMap/${MAP_ID}`)))
  })

  it('denies a read from an authenticated non-staff client', async () => {
    const db = testEnv.authenticatedContext('user1').firestore()
    await assertFails(getDoc(doc(db, `supplierSkuMap/${MAP_ID}`)))
  })

  it('allows a read from an authenticated staff client', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), `supplierSkuMap/${MAP_ID}`), MAP_DOC)
    })

    const db = testEnv.authenticatedContext('staff1', { staff: true }).firestore()
    await assertSucceeds(getDoc(doc(db, `supplierSkuMap/${MAP_ID}`)))
  })

  it('denies a write even from staff — mappings are only upserted by the receiving callable', async () => {
    const db = testEnv.authenticatedContext('staff1', { staff: true }).firestore()
    await assertFails(setDoc(doc(db, `supplierSkuMap/${MAP_ID}`), MAP_DOC))
  })
})
