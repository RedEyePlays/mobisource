import { readFileSync } from 'node:fs'
import {
  assertFails,
  initializeTestEnvironment,
} from '@firebase/rules-unit-testing'
import type { RulesTestEnvironment } from '@firebase/rules-unit-testing'
import { doc, getDoc, setDoc } from 'firebase/firestore'
import { afterAll, afterEach, beforeAll, describe, it } from 'vitest'

let testEnv: RulesTestEnvironment

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
  // Every collection in docs/SCHEMA.md now has its own explicit rules, so
  // there's no real collection left to use as a "no rule yet" stand-in.
  // Use a name that will never be a real collection instead — the rule
  // engine only cares about the path, not whether it's a schema concept.

  it('denies an unauthenticated client', async () => {
    const db = testEnv.unauthenticatedContext().firestore()

    await assertFails(getDoc(doc(db, 'notARealCollection/doc1')))
    await assertFails(setDoc(doc(db, 'notARealCollection/doc1'), { anything: true }))
  })

  it('denies an authenticated staff client with no per-collection rule', async () => {
    const db = testEnv.authenticatedContext('staff1', { staff: true }).firestore()

    await assertFails(getDoc(doc(db, 'notARealCollection/doc1')))
    await assertFails(setDoc(doc(db, 'notARealCollection/doc1'), { anything: true }))
  })
})
