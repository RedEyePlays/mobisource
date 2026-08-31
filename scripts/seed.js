import { initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  console.error(
    'FIRESTORE_EMULATOR_HOST is not set — refusing to run. This script writes with the ' +
      'admin SDK, bypassing security rules, and must never touch a real project. ' +
      'Run it via `npm run seed:emulator`.',
  )
  process.exit(1)
}

const app = initializeApp({ projectId: 'demo-mobisource' })
const db = getFirestore(app)

// Cents. Rough relative values, not a real price list — this is dev/emulator seed data.
function sku({ skuCode, partType, model, grade, source, trackingMode, expectedResale }) {
  return {
    skuCode,
    partType,
    model,
    grade,
    source,
    trackingMode,
    expectedResale,
    listPriceRetail: Math.round(expectedResale * 1.3),
    listPriceTier1: Math.round(expectedResale * 1.2),
    listPriceTier2: Math.round(expectedResale * 1.1),
    listPriceTier3: expectedResale,
    active: true,
  }
}

const MODEL = 'IP14P'

const skus = [
  sku({ skuCode: `MS-SCRN-${MODEL}-A-PULL`, partType: 'SCRN', model: MODEL, grade: 'A', source: 'PULL', trackingMode: 'serialized', expectedResale: 22000 }),
  sku({ skuCode: `MS-SCRN-${MODEL}-B-PULL`, partType: 'SCRN', model: MODEL, grade: 'B', source: 'PULL', trackingMode: 'serialized', expectedResale: 16000 }),
  sku({ skuCode: `MS-SCRN-${MODEL}-N-AFT`, partType: 'SCRN', model: MODEL, grade: 'N', source: 'AFT', trackingMode: 'bulk', expectedResale: 9000 }),
  sku({ skuCode: `MS-LOGIC-${MODEL}-A-PULL`, partType: 'LOGIC', model: MODEL, grade: 'A', source: 'PULL', trackingMode: 'serialized', expectedResale: 12000 }),
  sku({ skuCode: `MS-HOUSASM-${MODEL}-A-PULL`, partType: 'HOUSASM', model: MODEL, grade: 'A', source: 'PULL', trackingMode: 'serialized', expectedResale: 9000 }),
  sku({ skuCode: `MS-CAMR-${MODEL}-A-PULL`, partType: 'CAMR', model: MODEL, grade: 'A', source: 'PULL', trackingMode: 'serialized', expectedResale: 6000 }),
  sku({ skuCode: `MS-CAMF-${MODEL}-A-PULL`, partType: 'CAMF', model: MODEL, grade: 'A', source: 'PULL', trackingMode: 'serialized', expectedResale: 4000 }),
  sku({ skuCode: `MS-BATT-${MODEL}-B-PULL`, partType: 'BATT', model: MODEL, grade: 'B', source: 'PULL', trackingMode: 'serialized', expectedResale: 2500 }),
  sku({ skuCode: `MS-BATT-${MODEL}-N-AFT`, partType: 'BATT', model: MODEL, grade: 'N', source: 'AFT', trackingMode: 'bulk', expectedResale: 1500 }),
  sku({ skuCode: `MS-CHRG-${MODEL}-A-PULL`, partType: 'CHRG', model: MODEL, grade: 'A', source: 'PULL', trackingMode: 'serialized', expectedResale: 1200 }),
  sku({ skuCode: `MS-NFC-${MODEL}-A-PULL`, partType: 'NFC', model: MODEL, grade: 'A', source: 'PULL', trackingMode: 'serialized', expectedResale: 1000 }),
  sku({ skuCode: `MS-SPKR-${MODEL}-A-PULL`, partType: 'SPKR', model: MODEL, grade: 'A', source: 'PULL', trackingMode: 'serialized', expectedResale: 900 }),
  sku({ skuCode: `MS-EARP-${MODEL}-A-PULL`, partType: 'EARP', model: MODEL, grade: 'A', source: 'PULL', trackingMode: 'serialized', expectedResale: 600 }),
  sku({ skuCode: `MS-PROX-${MODEL}-A-PULL`, partType: 'PROX', model: MODEL, grade: 'A', source: 'PULL', trackingMode: 'serialized', expectedResale: 500 }),
  sku({ skuCode: `MS-FLSH-${MODEL}-A-PULL`, partType: 'FLSH', model: MODEL, grade: 'A', source: 'PULL', trackingMode: 'serialized', expectedResale: 500 }),
  sku({ skuCode: `MS-TAPT-${MODEL}-A-PULL`, partType: 'TAPT', model: MODEL, grade: 'A', source: 'PULL', trackingMode: 'serialized', expectedResale: 3500 }),
  sku({ skuCode: `MS-BGLS-${MODEL}-C-PULL`, partType: 'BGLS', model: MODEL, grade: 'C', source: 'PULL', trackingMode: 'serialized', expectedResale: 6000 }),
]

// All 'intact' — no teardowns or resales exist yet in phase 1, so nothing here
// should claim a status that depends on collections that don't exist.
const donors = [
  {
    model: MODEL,
    imei: '011112223334445',
    imeiBlankReason: '',
    purchaseCost: 40000,
    purchaseCurrency: 'CAD',
    fxRateUsed: null,
    purchaseDate: new Date('2026-08-15'),
    source: 'local',
    supplierRef: 'walk-in-0001',
    condition: 'A',
    status: 'intact',
    teardownId: '',
    resoldPrice: null,
    resoldDate: null,
    resoldBuyerId: '',
    notes: 'Mint condition, screen protector on since new.',
  },
  {
    model: MODEL,
    imei: '011112223334446',
    imeiBlankReason: '',
    purchaseCost: 32000,
    purchaseCurrency: 'USD',
    fxRateUsed: 1.37,
    purchaseDate: new Date('2026-08-18'),
    source: 'china',
    supplierRef: 'sz-batch-0042',
    condition: 'C',
    status: 'intact',
    teardownId: '',
    resoldPrice: null,
    resoldDate: null,
    resoldBuyerId: '',
    notes: 'Cracked back glass, screen intact.',
  },
  {
    model: MODEL,
    imei: '',
    imeiBlankReason: 'Dead board — device will not power on, IMEI unreadable.',
    purchaseCost: 8000,
    purchaseCurrency: 'CAD',
    fxRateUsed: null,
    purchaseDate: new Date('2026-08-20'),
    source: 'trade-in',
    supplierRef: '',
    condition: 'D',
    status: 'intact',
    teardownId: '',
    resoldPrice: null,
    resoldDate: null,
    resoldBuyerId: '',
    notes: 'Bought for the housing and camera modules only.',
  },
]

const teardownProfiles = [
  {
    profileId: `${MODEL}-AB`,
    model: MODEL,
    donorGrade: 'AB',
    expectedParts: [
      { skuCode: `MS-SCRN-${MODEL}-A-PULL`, likelihood: 0.9 },
      { skuCode: `MS-LOGIC-${MODEL}-A-PULL`, likelihood: 0.95 },
      { skuCode: `MS-HOUSASM-${MODEL}-A-PULL`, likelihood: 0.9 },
      { skuCode: `MS-CAMR-${MODEL}-A-PULL`, likelihood: 0.95 },
      { skuCode: `MS-CAMF-${MODEL}-A-PULL`, likelihood: 0.9 },
      { skuCode: `MS-BATT-${MODEL}-B-PULL`, likelihood: 0.3 },
    ],
  },
  {
    profileId: `${MODEL}-CD`,
    model: MODEL,
    donorGrade: 'CD',
    expectedParts: [
      { skuCode: `MS-SCRN-${MODEL}-B-PULL`, likelihood: 0.6 },
      { skuCode: `MS-LOGIC-${MODEL}-A-PULL`, likelihood: 0.95 },
      { skuCode: `MS-CHRG-${MODEL}-A-PULL`, likelihood: 0.9 },
      { skuCode: `MS-NFC-${MODEL}-A-PULL`, likelihood: 0.8 },
      { skuCode: `MS-SPKR-${MODEL}-A-PULL`, likelihood: 0.8 },
      { skuCode: `MS-EARP-${MODEL}-A-PULL`, likelihood: 0.8 },
      { skuCode: `MS-PROX-${MODEL}-A-PULL`, likelihood: 0.7 },
      { skuCode: `MS-FLSH-${MODEL}-A-PULL`, likelihood: 0.6 },
      { skuCode: `MS-TAPT-${MODEL}-A-PULL`, likelihood: 0.8 },
      { skuCode: `MS-CAMR-${MODEL}-A-PULL`, likelihood: 0.9 },
      { skuCode: `MS-CAMF-${MODEL}-A-PULL`, likelihood: 0.9 },
      { skuCode: `MS-BGLS-${MODEL}-C-PULL`, likelihood: 0.4 },
    ],
  },
]

async function seed() {
  const batch = db.batch()

  for (const doc of skus) {
    batch.set(db.collection('skus').doc(doc.skuCode), doc)
  }
  for (const [i, doc] of donors.entries()) {
    batch.set(db.collection('donors').doc(`donor-seed-${i + 1}`), doc)
  }
  for (const doc of teardownProfiles) {
    batch.set(db.collection('teardownProfiles').doc(doc.profileId), doc)
  }

  await batch.commit()

  console.log(
    `Seeded ${skus.length} skus, ${donors.length} donors, ${teardownProfiles.length} teardownProfiles.`,
  )
}

seed().catch((err) => {
  console.error(err)
  process.exit(1)
})
