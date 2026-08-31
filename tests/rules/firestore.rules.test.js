import { readFileSync } from 'node:fs'
import {
  assertFails,
  initializeTestEnvironment,
} from '@firebase/rules-unit-testing'
import { doc, getDoc, setDoc } from 'firebase/firestore'
import { afterAll, afterEach, beforeAll, describe, it } from 'vitest'

let testEnv

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

describe('firestore.rules deny-all default', () => {
  // bulkStock/ has no per-collection rule yet (that lands with its own
  // phase), so it's a stand-in for "anything not explicitly listed in
  // firestore.rules".

  it('denies an unauthenticated client', async () => {
    const db = testEnv.unauthenticatedContext().firestore()

    await assertFails(getDoc(doc(db, 'bulkStock/MS-BATT-IP14P-N-AFT')))
    await assertFails(setDoc(doc(db, 'bulkStock/MS-BATT-IP14P-N-AFT'), { qtyOnHand: 10 }))
  })

  it('denies an authenticated staff client with no per-collection rule', async () => {
    const db = testEnv.authenticatedContext('staff1', { staff: true }).firestore()

    await assertFails(getDoc(doc(db, 'bulkStock/MS-BATT-IP14P-N-AFT')))
    await assertFails(setDoc(doc(db, 'bulkStock/MS-BATT-IP14P-N-AFT'), { qtyOnHand: 10 }))
  })
})
