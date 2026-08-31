import { onCall, HttpsError } from 'firebase-functions/v2/https'
import { getFirestore } from 'firebase-admin/firestore'
import { generateSkuCode } from './lib/generateSkuCode.js'

const PRICE_FIELDS = ['listPriceRetail', 'listPriceTier1', 'listPriceTier2', 'listPriceTier3', 'expectedResale']

function requireStaff(request) {
  if (request.auth?.token?.staff !== true) {
    throw new HttpsError('permission-denied', 'Staff only.')
  }
}

function validatePriceCents(fieldName, value) {
  if (!Number.isInteger(value) || value < 0) {
    throw new HttpsError('invalid-argument', `${fieldName} must be a non-negative integer (cents).`)
  }
}

export const createSku = onCall(async (request) => {
  requireStaff(request)
  const data = request.data ?? {}

  let skuCode
  try {
    skuCode = generateSkuCode(data)
  } catch (err) {
    throw new HttpsError('invalid-argument', err.message)
  }

  for (const field of PRICE_FIELDS) {
    validatePriceCents(field, data[field])
  }

  const db = getFirestore()
  const ref = db.collection('skus').doc(skuCode)

  const existing = await ref.get()
  if (existing.exists) {
    throw new HttpsError('already-exists', `${skuCode} already exists.`)
  }

  await ref.set({
    skuCode,
    partType: data.partType,
    model: data.model,
    grade: data.grade,
    source: data.source,
    trackingMode: data.trackingMode,
    listPriceRetail: data.listPriceRetail,
    listPriceTier1: data.listPriceTier1,
    listPriceTier2: data.listPriceTier2,
    listPriceTier3: data.listPriceTier3,
    expectedResale: data.expectedResale,
    active: true,
  })

  return { skuCode }
})

export const updateSku = onCall(async (request) => {
  requireStaff(request)
  const { skuCode, ...updates } = request.data ?? {}

  if (!skuCode) {
    throw new HttpsError('invalid-argument', 'skuCode is required.')
  }

  // Identity fields (partType/model/grade/source) define the doc ID and are
  // immutable — changing one means a different SKU, not an edit. active is
  // only ever flipped by deactivateSku, to keep that action explicit.
  const immutableFields = ['partType', 'model', 'grade', 'source', 'active']
  for (const field of immutableFields) {
    if (field in updates) {
      throw new HttpsError(
        'invalid-argument',
        field === 'active'
          ? 'active can only be changed via deactivateSku.'
          : `${field} is immutable — create a new SKU instead.`,
      )
    }
  }

  const fieldsToUpdate = Object.keys(updates)
  if (fieldsToUpdate.length === 0) {
    throw new HttpsError('invalid-argument', 'No fields to update.')
  }
  for (const field of fieldsToUpdate) {
    if (!PRICE_FIELDS.includes(field)) {
      throw new HttpsError('invalid-argument', `Unknown field: ${field}`)
    }
    validatePriceCents(field, updates[field])
  }

  const db = getFirestore()
  const ref = db.collection('skus').doc(skuCode)
  const snap = await ref.get()
  if (!snap.exists) {
    throw new HttpsError('not-found', `${skuCode} not found.`)
  }

  // expectedResale here only affects FUTURE allocations. A teardown
  // snapshots expectedResale into stockItems.allocatedCost at teardown
  // time (see allocateDonorCost) — changing it here must never reach back
  // into stockItems already created from an earlier teardown. Tested in
  // the teardown callable's own suite (session 5), not here.
  await ref.update(updates)

  return { skuCode }
})

export const deactivateSku = onCall(async (request) => {
  requireStaff(request)
  const { skuCode } = request.data ?? {}
  if (!skuCode) {
    throw new HttpsError('invalid-argument', 'skuCode is required.')
  }

  const db = getFirestore()
  const ref = db.collection('skus').doc(skuCode)
  const snap = await ref.get()
  if (!snap.exists) {
    throw new HttpsError('not-found', `${skuCode} not found.`)
  }

  await ref.update({ active: false })
  return { skuCode }
})
