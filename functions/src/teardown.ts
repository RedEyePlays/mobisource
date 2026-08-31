import { onCall, HttpsError } from 'firebase-functions/v2/https'
import { getFirestore } from 'firebase-admin/firestore'
import { teardownDonor } from './lib/teardownDonor.js'
import type { TeardownDonorInput } from './lib/teardownDonor.js'

export const performTeardown = onCall<Partial<TeardownDonorInput>>(async (request) => {
  const token = request.auth?.token as Record<string, unknown> | undefined
  if (token?.staff !== true) {
    throw new HttpsError('permission-denied', 'Staff only.')
  }

  try {
    return await teardownDonor(getFirestore(), (request.data ?? {}) as TeardownDonorInput)
  } catch (err) {
    throw new HttpsError('failed-precondition', (err as Error).message)
  }
})
