import { readFileSync } from 'node:fs'
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from '@firebase/rules-unit-testing'
import { doc, getDoc, setDoc } from 'firebase/firestore'
import { afterAll, afterEach, beforeAll, describe, it } from 'vitest'

let testEnv

const TEARDOWN_ID = 'teardown1'
const TEARDOWN_DOC = {
  teardownId: TEARDOWN_ID,
  donorId: 'donor1',
  performedAt: new Date('2026-08-31'),
  donorCost: 40000,
  allocations: [{ skuCode: 'MS-SCRN-IP14P-A-PULL', expectedResale: 22000, sharePct: 1, allocatedCost: 40000 }],
  itemsCreated: ['item1'],
  scrapped: [],
  notHarvested: [],
  costCheck: 40000,
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

describe('teardowns rules', () => {
  it('denies an unauthenticated read', async () => {
    const db = testEnv.unauthenticatedContext().firestore()
    await assertFails(getDoc(doc(db, `teardowns/${TEARDOWN_ID}`)))
  })

  it('denies a read from an authenticated non-staff client', async () => {
    const db = testEnv.authenticatedContext('user1').firestore()
    await assertFails(getDoc(doc(db, `teardowns/${TEARDOWN_ID}`)))
  })

  it('allows a read from an authenticated staff client', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), `teardowns/${TEARDOWN_ID}`), TEARDOWN_DOC)
    })

    const db = testEnv.authenticatedContext('staff1', { staff: true }).firestore()
    await assertSucceeds(getDoc(doc(db, `teardowns/${TEARDOWN_ID}`)))
  })

  it('denies a write even from staff — teardowns are only created by the teardown callable', async () => {
    const db = testEnv.authenticatedContext('staff1', { staff: true }).firestore()
    await assertFails(setDoc(doc(db, `teardowns/${TEARDOWN_ID}`), TEARDOWN_DOC))
  })
})
