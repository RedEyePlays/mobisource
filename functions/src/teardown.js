import { onCall, HttpsError } from 'firebase-functions/v2/https'
import { getFirestore } from 'firebase-admin/firestore'
import { teardownDonor } from './lib/teardownDonor.js'

export const performTeardown = onCall(async (request) => {
  if (request.auth?.token?.staff !== true) {
    throw new HttpsError('permission-denied', 'Staff only.')
  }

  try {
    return await teardownDonor(getFirestore(), request.data ?? {})
  } catch (err) {
    throw new HttpsError('failed-precondition', err.message)
  }
})
