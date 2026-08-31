import { readFileSync } from 'node:fs'
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from '@firebase/rules-unit-testing'
import { doc, getDoc, setDoc } from 'firebase/firestore'
import { afterAll, afterEach, beforeAll, describe, it } from 'vitest'

let testEnv

const ORDER_ID = 'order1'
const ORDER_DOC = {
  orderId: ORDER_ID,
  buyerId: 'buyer1',
  lines: [{ skuCode: 'MS-SCRN-IP14P-A-PULL', itemId: 'item1', qty: 1, unitPrice: 20000, unitCost: 16925 }],
  subtotal: 20000,
  tax: 0,
  total: 20000,
  status: 'quoted',
  createdAt: new Date('2026-08-31'),
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

describe('salesOrders rules', () => {
  it('denies an unauthenticated read', async () => {
    const db = testEnv.unauthenticatedContext().firestore()
    await assertFails(getDoc(doc(db, `salesOrders/${ORDER_ID}`)))
  })

  it('denies a read from an authenticated non-staff client', async () => {
    const db = testEnv.authenticatedContext('user1').firestore()
    await assertFails(getDoc(doc(db, `salesOrders/${ORDER_ID}`)))
  })

  it('allows a read from an authenticated staff client', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), `salesOrders/${ORDER_ID}`), ORDER_DOC)
    })

    const db = testEnv.authenticatedContext('staff1', { staff: true }).firestore()
    await assertSucceeds(getDoc(doc(db, `salesOrders/${ORDER_ID}`)))
  })

  it('denies a write even from staff — orders are only created/confirmed through callables', async () => {
    const db = testEnv.authenticatedContext('staff1', { staff: true }).firestore()
    await assertFails(setDoc(doc(db, `salesOrders/${ORDER_ID}`), ORDER_DOC))
  })
})
