import { initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import type { Firestore } from 'firebase-admin/firestore'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { teardownDonor } from '../src/lib/teardownDonor.js'

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

const MODEL = 'IP14P'
const SCRN = 'MS-SCRN-IP14P-A-PULL'
const LOGIC = 'MS-LOGIC-IP14P-A-PULL'
const BATT = 'MS-BATT-IP14P-B-PULL'
const CAMR = 'MS-CAMR-IP14P-A-PULL'

async function seedCatalog() {
  await db.collection('skus').doc(SCRN).set({
    skuCode: SCRN, partType: 'SCRN', model: MODEL, grade: 'A', source: 'PULL',
    trackingMode: 'serialized', expectedResale: 22000, listPriceRetail: 26000,
    listPriceTier1: 24000, listPriceTier2: 22500, listPriceTier3: 21000, active: true,
  })
  await db.collection('skus').doc(LOGIC).set({
    skuCode: LOGIC, partType: 'LOGIC', model: MODEL, grade: 'A', source: 'PULL',
    trackingMode: 'serialized', expectedResale: 12000, listPriceRetail: 15000,
    listPriceTier1: 14000, listPriceTier2: 13000, listPriceTier3: 12000, active: true,
  })
  await db.collection('skus').doc(BATT).set({
    skuCode: BATT, partType: 'BATT', model: MODEL, grade: 'B', source: 'PULL',
    trackingMode: 'serialized', expectedResale: 2500, listPriceRetail: 3000,
    listPriceTier1: 2800, listPriceTier2: 2600, listPriceTier3: 2500, active: true,
  })
  await db.collection('skus').doc(CAMR).set({
    skuCode: CAMR, partType: 'CAMR', model: MODEL, grade: 'A', source: 'PULL',
    trackingMode: 'serialized', expectedResale: 6000, listPriceRetail: 7500,
    listPriceTier1: 7000, listPriceTier2: 6500, listPriceTier3: 6000, active: true,
  })

  await db.collection('teardownProfiles').doc(`${MODEL}-AB`).set({
    profileId: `${MODEL}-AB`,
    model: MODEL,
    donorGrade: 'AB',
    expectedParts: [
      { skuCode: SCRN, likelihood: 0.9 },
      { skuCode: LOGIC, likelihood: 0.95 },
      { skuCode: BATT, likelihood: 0.3 },
      { skuCode: CAMR, likelihood: 0.95 },
    ],
  })
}

async function seedIntactDonor(id: string, overrides: Record<string, unknown> = {}) {
  await db.collection('donors').doc(id).set({
    model: MODEL,
    imei: '011112223334445',
    imeiBlankReason: '',
    purchaseCost: 40000,
    purchaseCurrency: 'CAD',
    fxRateUsed: null,
    purchaseDate: new Date('2026-08-01'),
    source: 'local',
    supplierRef: '',
    condition: 'A',
    status: 'intact',
    teardownId: '',
    resoldPrice: null,
    resoldDate: null,
    resoldBuyerId: '',
    notes: '',
    ...overrides,
  })
}

async function countDocs(collection: string) {
  const snap = await db.collection(collection).get()
  return snap.size
}

describe('teardownDonor', () => {
  it('creates stockItems for sellable and scrapped parts, logs notHarvested, and sums allocatedCost to donorCost', async () => {
    await seedCatalog()
    await seedIntactDonor('donor1')

    const result = await teardownDonor(db, {
      donorId: 'donor1',
      parts: [
        { skuCode: SCRN, outcome: 'sellable' },
        { skuCode: LOGIC, outcome: 'sellable' },
        { skuCode: BATT, outcome: 'scrapped', reason: 'swollen' },
        // CAMR omitted entirely -> notHarvested
      ],
    })

    expect(result.itemsCreated).toHaveLength(3)

    const teardownSnap = await db.collection('teardowns').doc(result.teardownId).get()
    const teardown = teardownSnap.data()!
    expect(teardown.donorId).toBe('donor1')
    expect(teardown.donorCost).toBe(40000)
    expect(teardown.allocations).toHaveLength(2)
    expect(
      teardown.allocations.reduce((sum: number, a: { allocatedCost: number }) => sum + a.allocatedCost, 0),
    ).toBe(40000)
    expect(teardown.costCheck).toBe(40000)
    expect(teardown.scrapped).toEqual([{ partType: 'BATT', reason: 'swollen' }])
    expect(teardown.notHarvested).toEqual([{ partType: 'CAMR', reason: '' }])

    const donorSnap = await db.collection('donors').doc('donor1').get()
    expect(donorSnap.data()!.status).toBe('tornDown')
    expect(donorSnap.data()!.teardownId).toBe(result.teardownId)

    const itemsSnap = await db.collection('stockItems').where('donorId', '==', 'donor1').get()
    expect(itemsSnap.size).toBe(3)
    const items = itemsSnap.docs.map((d) => d.data())
    const scrn = items.find((i) => i.skuCode === SCRN)!
    const batt = items.find((i) => i.skuCode === BATT)!
    expect(scrn.status).toBe('inStock')
    expect(scrn.allocatedCost).toBeGreaterThan(0)
    expect(batt.status).toBe('scrapped')
    expect(batt.allocatedCost).toBe(0)

    const movementsSnap = await db.collection('stockMovements').where('ref', '==', 'donor1').get()
    const movements = movementsSnap.docs.map((d) => d.data())
    expect(movements.filter((m) => m.type === 'teardownIn')).toHaveLength(1)
    expect(movements.filter((m) => m.type === 'teardownOut')).toHaveLength(3)
    expect(movements.filter((m) => m.type === 'scrap')).toHaveLength(1)
  })

  it('rolls back entirely when the donor is no longer intact — no partial writes', async () => {
    await seedCatalog()
    await seedIntactDonor('donor2')

    await teardownDonor(db, { donorId: 'donor2', parts: [{ skuCode: SCRN, outcome: 'sellable' }] })

    const teardownCountAfterFirst = await countDocs('teardowns')
    const itemCountAfterFirst = await countDocs('stockItems')
    const movementCountAfterFirst = await countDocs('stockMovements')

    await expect(
      teardownDonor(db, { donorId: 'donor2', parts: [{ skuCode: LOGIC, outcome: 'sellable' }] }),
    ).rejects.toThrow(/intact/)

    expect(await countDocs('teardowns')).toBe(teardownCountAfterFirst)
    expect(await countDocs('stockItems')).toBe(itemCountAfterFirst)
    expect(await countDocs('stockMovements')).toBe(movementCountAfterFirst)

    const donorSnap = await db.collection('donors').doc('donor2').get()
    expect(donorSnap.data()!.status).toBe('tornDown')
  })

  it('freezes expectedResale at teardown time — a later SKU price change never touches an existing teardown', async () => {
    await seedCatalog()
    await seedIntactDonor('donor3')

    const result = await teardownDonor(db, {
      donorId: 'donor3',
      parts: [
        { skuCode: SCRN, outcome: 'sellable' },
        { skuCode: LOGIC, outcome: 'sellable' },
      ],
    })

    const itemsBefore = await db.collection('stockItems').where('donorId', '==', 'donor3').get()
    const scrnItemBefore = itemsBefore.docs.map((d) => d.data()).find((i) => i.skuCode === SCRN)!
    const teardownBefore = (await db.collection('teardowns').doc(result.teardownId).get()).data()!

    // Simulate updateSku changing expectedResale well after this teardown.
    await db.collection('skus').doc(SCRN).update({ expectedResale: 999999 })

    const itemsAfter = await db.collection('stockItems').where('donorId', '==', 'donor3').get()
    const scrnItemAfter = itemsAfter.docs.map((d) => d.data()).find((i) => i.skuCode === SCRN)!
    const teardownAfter = (await db.collection('teardowns').doc(result.teardownId).get()).data()!

    expect(scrnItemAfter.allocatedCost).toBe(scrnItemBefore.allocatedCost)
    expect(teardownAfter.allocations).toEqual(teardownBefore.allocations)
    expect(teardownAfter.costCheck).toBe(teardownBefore.costCheck)
  })

  it('accepts a part outside the profile as long as it is an existing, active SKU', async () => {
    await seedCatalog()
    // Bumper, not in either teardown profile — but a real, active SKU.
    const BUMPER = 'MS-HOUS-IP14P-A-PULL'
    await db.collection('skus').doc(BUMPER).set({
      skuCode: BUMPER, partType: 'HOUS', model: MODEL, grade: 'A', source: 'PULL',
      trackingMode: 'serialized', expectedResale: 4000, listPriceRetail: 5000,
      listPriceTier1: 4800, listPriceTier2: 4400, listPriceTier3: 4000, active: true,
    })
    await seedIntactDonor('donor4')

    const result = await teardownDonor(db, {
      donorId: 'donor4',
      parts: [
        { skuCode: SCRN, outcome: 'sellable' },
        { skuCode: BUMPER, outcome: 'sellable' },
      ],
    })

    const teardown = (await db.collection('teardowns').doc(result.teardownId).get()).data()!
    expect(teardown.allocations.map((a: { skuCode: string }) => a.skuCode).sort()).toEqual([BUMPER, SCRN].sort())
    expect(
      teardown.allocations.reduce((sum: number, a: { allocatedCost: number }) => sum + a.allocatedCost, 0),
    ).toBe(40000)

    const bumperItem = (
      await db.collection('stockItems').where('donorId', '==', 'donor4').where('skuCode', '==', BUMPER).get()
    ).docs[0].data()
    expect(bumperItem.status).toBe('inStock')
    expect(bumperItem.allocatedCost).toBeGreaterThan(0)
  })

  it('rejects a submitted skuCode with no matching SKU in the catalog, with no writes', async () => {
    await seedCatalog()
    await seedIntactDonor('donor5')

    await expect(
      teardownDonor(db, {
        donorId: 'donor5',
        parts: [
          { skuCode: SCRN, outcome: 'sellable' },
          { skuCode: 'MS-NFC-IP14P-A-PULL', outcome: 'sellable' }, // never created
        ],
      }),
    ).rejects.toThrow(/not found/)

    expect(await countDocs('teardowns')).toBe(0)
    expect(await countDocs('stockItems')).toBe(0)
    const donorSnap = await db.collection('donors').doc('donor5').get()
    expect(donorSnap.data()!.status).toBe('intact')
  })

  it('rejects a submitted skuCode that exists but is deactivated, with no writes', async () => {
    await seedCatalog()
    const RETIRED = 'MS-CHRG-IP14P-A-PULL'
    await db.collection('skus').doc(RETIRED).set({
      skuCode: RETIRED, partType: 'CHRG', model: MODEL, grade: 'A', source: 'PULL',
      trackingMode: 'serialized', expectedResale: 1200, listPriceRetail: 1500,
      listPriceTier1: 1400, listPriceTier2: 1300, listPriceTier3: 1200, active: false,
    })
    await seedIntactDonor('donor6')

    await expect(
      teardownDonor(db, {
        donorId: 'donor6',
        parts: [
          { skuCode: SCRN, outcome: 'sellable' },
          { skuCode: RETIRED, outcome: 'sellable' },
        ],
      }),
    ).rejects.toThrow(/not an active SKU/)

    expect(await countDocs('teardowns')).toBe(0)
    expect(await countDocs('stockItems')).toBe(0)
  })

  it('throws for a donor that does not exist, with no writes', async () => {
    await seedCatalog()

    await expect(
      teardownDonor(db, { donorId: 'no-such-donor', parts: [{ skuCode: SCRN, outcome: 'sellable' }] }),
    ).rejects.toThrow(/not found/)

    expect(await countDocs('teardowns')).toBe(0)
    expect(await countDocs('stockItems')).toBe(0)
  })
})
