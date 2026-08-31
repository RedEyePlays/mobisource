import type { CallableRequest } from 'firebase-functions/v2/https'
import { onCall, HttpsError } from 'firebase-functions/v2/https'
import { getFirestore } from 'firebase-admin/firestore'
import type { WithFieldValue } from 'firebase-admin/firestore'
import { generateSkuCode } from './lib/generateSkuCode.js'
import type { Sku } from './lib/types.js'

const PRICE_FIELDS = ['listPriceRetail', 'listPriceTier1', 'listPriceTier2', 'listPriceTier3', 'expectedResale'] as const

function requireStaff(request: CallableRequest<unknown>): void {
  const token = request.auth?.token as Record<string, unknown> | undefined
  if (token?.staff !== true) {
    throw new HttpsError('permission-denied', 'Staff only.')
  }
}

function validatePriceCents(fieldName: string, value: unknown): void {
  if (!Number.isInteger(value) || (value as number) < 0) {
    throw new HttpsError('invalid-argument', `${fieldName} must be a non-negative integer (cents).`)
  }
}

interface CreateSkuInput {
  partType?: unknown
  model?: unknown
  grade?: unknown
  source?: unknown
  trackingMode?: unknown
  listPriceRetail?: unknown
  listPriceTier1?: unknown
  listPriceTier2?: unknown
  listPriceTier3?: unknown
  expectedResale?: unknown
}

interface UpdateSkuInput {
  skuCode?: unknown
  [field: string]: unknown
}

interface DeactivateSkuInput {
  skuCode?: unknown
}

export const createSku = onCall<CreateSkuInput>(async (request) => {
  requireStaff(request)
  const data = request.data ?? {}

  let skuCode: string
  try {
    skuCode = generateSkuCode({
      partType: data.partType as string,
      model: data.model as string,
      grade: data.grade as string,
      source: data.source as string,
    })
  } catch (err) {
    throw new HttpsError('invalid-argument', (err as Error).message)
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

  const sku: WithFieldValue<Sku> = {
    skuCode,
    partType: data.partType as Sku['partType'],
    model: data.model as string,
    grade: data.grade as Sku['grade'],
    source: data.source as Sku['source'],
    trackingMode: data.trackingMode as Sku['trackingMode'],
    listPriceRetail: data.listPriceRetail as Sku['listPriceRetail'],
    listPriceTier1: data.listPriceTier1 as Sku['listPriceTier1'],
    listPriceTier2: data.listPriceTier2 as Sku['listPriceTier2'],
    listPriceTier3: data.listPriceTier3 as Sku['listPriceTier3'],
    expectedResale: data.expectedResale as Sku['expectedResale'],
    active: true,
  }
  await ref.set(sku)

  return { skuCode }
})

export const updateSku = onCall<UpdateSkuInput>(async (request) => {
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
    if (!(PRICE_FIELDS as readonly string[]).includes(field)) {
      throw new HttpsError('invalid-argument', `Unknown field: ${field}`)
    }
    validatePriceCents(field, updates[field])
  }

  const db = getFirestore()
  const ref = db.collection('skus').doc(skuCode as string)
  const snap = await ref.get()
  if (!snap.exists) {
    throw new HttpsError('not-found', `${skuCode} not found.`)
  }

  // expectedResale here only affects FUTURE allocations. A teardown
  // snapshots expectedResale into stockItems.allocatedCost at teardown
  // time (see allocateDonorCost) — changing it here must never reach back
  // into stockItems already created from an earlier teardown. Tested in
  // the teardown callable's own suite (session 5), not here.
  await ref.update(updates as Record<string, unknown>)

  return { skuCode }
})

export const deactivateSku = onCall<DeactivateSkuInput>(async (request) => {
  requireStaff(request)
  const { skuCode } = request.data ?? {}
  if (!skuCode) {
    throw new HttpsError('invalid-argument', 'skuCode is required.')
  }

  const db = getFirestore()
  const ref = db.collection('skus').doc(skuCode as string)
  const snap = await ref.get()
  if (!snap.exists) {
    throw new HttpsError('not-found', `${skuCode} not found.`)
  }

  await ref.update({ active: false })
  return { skuCode }
})
