import { onCall, HttpsError } from 'firebase-functions/v2/https'
import { getFirestore } from 'firebase-admin/firestore'
import { validateBuyerFields } from './lib/validateBuyer.js'

const ALLOWED_FIELDS = ['name', 'type', 'tier', 'terms', 'contact']

function requireStaff(request) {
  if (request.auth?.token?.staff !== true) {
    throw new HttpsError('permission-denied', 'Staff only.')
  }
}

export const createBuyer = onCall(async (request) => {
  requireStaff(request)
  const data = request.data ?? {}

  try {
    validateBuyerFields(data, { requireAll: true })
  } catch (err) {
    throw new HttpsError('invalid-argument', err.message)
  }

  const db = getFirestore()
  const ref = db.collection('buyers').doc()
  await ref.set({
    buyerId: ref.id,
    name: data.name,
    type: data.type,
    tier: data.tier,
    terms: data.terms,
    contact: data.contact ?? {},
  })

  return { buyerId: ref.id }
})

export const updateBuyer = onCall(async (request) => {
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
    throw new HttpsError('invalid-argument', err.message)
  }

  const db = getFirestore()
  const ref = db.collection('buyers').doc(buyerId)
  const snap = await ref.get()
  if (!snap.exists) {
    throw new HttpsError('not-found', `Buyer not found: ${buyerId}`)
  }

  await ref.update(updates)
  return { buyerId }
})
