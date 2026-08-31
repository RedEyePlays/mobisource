import { onCall, HttpsError } from 'firebase-functions/v2/https'
import { getFirestore } from 'firebase-admin/firestore'
import { createOrder as createOrderCore } from './lib/createOrder.js'
import { confirmOrder as confirmOrderCore } from './lib/confirmOrder.js'

function requireStaff(request) {
  if (request.auth?.token?.staff !== true) {
    throw new HttpsError('permission-denied', 'Staff only.')
  }
}

export const createOrder = onCall(async (request) => {
  requireStaff(request)
  try {
    return await createOrderCore(getFirestore(), request.data ?? {})
  } catch (err) {
    throw new HttpsError('failed-precondition', err.message)
  }
})

export const confirmOrder = onCall(async (request) => {
  requireStaff(request)
  try {
    return await confirmOrderCore(getFirestore(), request.data ?? {})
  } catch (err) {
    throw new HttpsError('failed-precondition', err.message)
  }
})
