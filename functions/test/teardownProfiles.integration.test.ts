import { initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import type { Firestore } from 'firebase-admin/firestore'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import {
  createTeardownProfile,
  updateTeardownProfile,
  deleteTeardownProfile,
} from '../src/lib/teardownProfiles.js'

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

async function seedSku(skuCode: string) {
  await db.collection('skus').doc(skuCode).set({
    skuCode,
    partType: 'SCRN',
    model: 'IP14P',
    grade: 'A',
    source: 'PULL',
    trackingMode: 'serialized',
    listPriceRetail: 22000,
    listPriceTier1: 20000,
    listPriceTier2: 18000,
    listPriceTier3: 16000,
    expectedResale: 15000,
    active: true,
  })
}

describe('createTeardownProfile', () => {
  it('creates a profile with a derived profileId', async () => {
    await seedSku('MS-SCRN-IP14P-A-PULL')
    const result = await createTeardownProfile(db, {
      model: 'IP14P',
      donorGrade: 'AB',
      expectedParts: [{ skuCode: 'MS-SCRN-IP14P-A-PULL', likelihood: 0.9 }],
    })

    expect(result.profileId).toBe('IP14P-AB')
    const doc = (await db.collection('teardownProfiles').doc('IP14P-AB').get()).data()!
    expect(doc.model).toBe('IP14P')
    expect(doc.donorGrade).toBe('AB')
    expect(doc.expectedParts).toEqual([{ skuCode: 'MS-SCRN-IP14P-A-PULL', likelihood: 0.9 }])
  })

  it('rejects an invalid model code', async () => {
    await expect(
      createTeardownProfile(db, { model: 'ip14p', donorGrade: 'AB', expectedParts: [{ skuCode: 'x', likelihood: 1 }] }),
    ).rejects.toThrow(/model/)
  })

  it('rejects an invalid donorGrade', async () => {
    await expect(
      createTeardownProfile(db, { model: 'IP14P', donorGrade: 'A', expectedParts: [{ skuCode: 'x', likelihood: 1 }] }),
    ).rejects.toThrow(/donorGrade/)
  })

  it('rejects an empty expectedParts array', async () => {
    await expect(
      createTeardownProfile(db, { model: 'IP14P', donorGrade: 'AB', expectedParts: [] }),
    ).rejects.toThrow(/expectedParts/)
  })

  it('rejects a duplicate skuCode within expectedParts', async () => {
    await seedSku('MS-SCRN-IP14P-A-PULL')
    await expect(
      createTeardownProfile(db, {
        model: 'IP14P',
        donorGrade: 'AB',
        expectedParts: [
          { skuCode: 'MS-SCRN-IP14P-A-PULL', likelihood: 0.9 },
          { skuCode: 'MS-SCRN-IP14P-A-PULL', likelihood: 0.5 },
        ],
      }),
    ).rejects.toThrow(/Duplicate/)
  })

  it('rejects a likelihood outside 0-1', async () => {
    await seedSku('MS-SCRN-IP14P-A-PULL')
    await expect(
      createTeardownProfile(db, {
        model: 'IP14P',
        donorGrade: 'AB',
        expectedParts: [{ skuCode: 'MS-SCRN-IP14P-A-PULL', likelihood: 1.1 }],
      }),
    ).rejects.toThrow(/likelihood/)
    await expect(
      createTeardownProfile(db, {
        model: 'IP14P',
        donorGrade: 'AB',
        expectedParts: [{ skuCode: 'MS-SCRN-IP14P-A-PULL', likelihood: -0.1 }],
      }),
    ).rejects.toThrow(/likelihood/)
  })

  it('allows a likelihood of exactly 0 or 1', async () => {
    await seedSku('MS-SCRN-IP14P-A-PULL')
    const result = await createTeardownProfile(db, {
      model: 'IP14P',
      donorGrade: 'AB',
      expectedParts: [{ skuCode: 'MS-SCRN-IP14P-A-PULL', likelihood: 0 }],
    })
    expect(result.profileId).toBe('IP14P-AB')
  })

  it('rejects a skuCode that does not exist', async () => {
    await expect(
      createTeardownProfile(db, {
        model: 'IP14P',
        donorGrade: 'AB',
        expectedParts: [{ skuCode: 'MS-NOPE-IP14P-A-PULL', likelihood: 0.5 }],
      }),
    ).rejects.toThrow(/Unknown skuCode/)
  })

  it('rejects creating a profile that already exists', async () => {
    await seedSku('MS-SCRN-IP14P-A-PULL')
    const input = {
      model: 'IP14P',
      donorGrade: 'AB' as const,
      expectedParts: [{ skuCode: 'MS-SCRN-IP14P-A-PULL', likelihood: 0.9 }],
    }
    await createTeardownProfile(db, input)
    await expect(createTeardownProfile(db, input)).rejects.toThrow(/already exists/)
  })
})

describe('updateTeardownProfile', () => {
  it('replaces expectedParts', async () => {
    await seedSku('MS-SCRN-IP14P-A-PULL')
    await seedSku('MS-LOGIC-IP14P-A-PULL')
    await createTeardownProfile(db, {
      model: 'IP14P',
      donorGrade: 'AB',
      expectedParts: [{ skuCode: 'MS-SCRN-IP14P-A-PULL', likelihood: 0.9 }],
    })

    await updateTeardownProfile(db, {
      profileId: 'IP14P-AB',
      expectedParts: [{ skuCode: 'MS-LOGIC-IP14P-A-PULL', likelihood: 0.95 }],
    })

    const doc = (await db.collection('teardownProfiles').doc('IP14P-AB').get()).data()!
    expect(doc.expectedParts).toEqual([{ skuCode: 'MS-LOGIC-IP14P-A-PULL', likelihood: 0.95 }])
    // model/donorGrade are untouched — identity fields, not editable here.
    expect(doc.model).toBe('IP14P')
    expect(doc.donorGrade).toBe('AB')
  })

  it('rejects updating a profile that does not exist', async () => {
    await seedSku('MS-SCRN-IP14P-A-PULL')
    await expect(
      updateTeardownProfile(db, {
        profileId: 'IP14P-AB',
        expectedParts: [{ skuCode: 'MS-SCRN-IP14P-A-PULL', likelihood: 0.9 }],
      }),
    ).rejects.toThrow(/not found/)
  })

  it('rejects a missing profileId', async () => {
    await expect(
      updateTeardownProfile(db, { expectedParts: [{ skuCode: 'x', likelihood: 0.9 }] }),
    ).rejects.toThrow(/profileId/)
  })
})

describe('deleteTeardownProfile', () => {
  it('deletes an existing profile', async () => {
    await seedSku('MS-SCRN-IP14P-A-PULL')
    await createTeardownProfile(db, {
      model: 'IP14P',
      donorGrade: 'AB',
      expectedParts: [{ skuCode: 'MS-SCRN-IP14P-A-PULL', likelihood: 0.9 }],
    })

    await deleteTeardownProfile(db, { profileId: 'IP14P-AB' })

    const doc = await db.collection('teardownProfiles').doc('IP14P-AB').get()
    expect(doc.exists).toBe(false)
  })

  it('rejects deleting a profile that does not exist', async () => {
    await expect(deleteTeardownProfile(db, { profileId: 'IP14P-AB' })).rejects.toThrow(/not found/)
  })

  it('rejects a missing profileId', async () => {
    await expect(deleteTeardownProfile(db, {})).rejects.toThrow(/profileId/)
  })
})
