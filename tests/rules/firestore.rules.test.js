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
  it('denies an unauthenticated client', async () => {
    const db = testEnv.unauthenticatedContext().firestore()

    await assertFails(getDoc(doc(db, 'donors/donor1')))
    await assertFails(setDoc(doc(db, 'donors/donor1'), { model: 'iPhone 12' }))
  })

  it('denies an authenticated client with no per-collection rule', async () => {
    const db = testEnv.authenticatedContext('user1').firestore()

    await assertFails(getDoc(doc(db, 'donors/donor1')))
    await assertFails(setDoc(doc(db, 'donors/donor1'), { model: 'iPhone 12' }))
  })
})
