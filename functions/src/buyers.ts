import type { CallableRequest } from 'firebase-functions/v2/https'
import { onCall, HttpsError } from 'firebase-functions/v2/https'
import { getFirestore } from 'firebase-admin/firestore'
import type { WithFieldValue } from 'firebase-admin/firestore'
import { validateBuyerFields } from './lib/validateBuyer.js'
import type { BuyerFieldsInput } from './lib/validateBuyer.js'
import type { Buyer } from './lib/types.js'

const ALLOWED_FIELDS = ['name', 'type', 'tier', 'terms', 'contact']

function requireStaff(request: CallableRequest<unknown>): void {
  const token = request.auth?.token as Record<string, unknown> | undefined
  if (token?.staff !== true) {
    throw new HttpsError('permission-denied', 'Staff only.')
  }
}

interface UpdateBuyerInput extends BuyerFieldsInput {
  buyerId?: unknown
}

export const createBuyer = onCall<BuyerFieldsInput>(async (request) => {
  requireStaff(request)
  const data = request.data ?? {}

  try {
    validateBuyerFields(data, { requireAll: true })
  } catch (err) {
    throw new HttpsError('invalid-argument', (err as Error).message)
  }

  const db = getFirestore()
  const ref = db.collection('buyers').doc()
  const buyer: WithFieldValue<Buyer> = {
    buyerId: ref.id,
    name: data.name as string,
    type: data.type as Buyer['type'],
    tier: data.tier as Buyer['tier'],
    terms: data.terms as Buyer['terms'],
    contact: (data.contact as Buyer['contact']) ?? {},
  }
  await ref.set(buyer)

  return { buyerId: ref.id }
})

export const updateBuyer = onCall<UpdateBuyerInput>(async (request) => {
  requireStaff(request)
  const { buyerId, ...updates } = request.data ?? {}

  if (!buyerId) {
    throw new HttpsError('invalid-argument', 'buyerId is required.')
  }
  const fields = Object.keys(updates)
  if (fields.length === 0) {
    throw new HttpsError('invalid-argument', 'No fields to update.')
  }
  for (const field of fields) {
    if (!ALLOWED_FIELDS.includes(field)) {
      throw new HttpsError('invalid-argument', `Unknown field: ${field}`)
    }
  }

  try {
    validateBuyerFields(updates)
  } catch (err) {
    throw new HttpsError('invalid-argument', (err as Error).message)
  }

  const db = getFirestore()
  const ref = db.collection('buyers').doc(buyerId as string)
  const snap = await ref.get()
  if (!snap.exists) {
    throw new HttpsError('not-found', `Buyer not found: ${buyerId}`)
  }

  await ref.update(updates as Record<string, unknown>)
  return { buyerId }
})
