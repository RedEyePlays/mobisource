import type { CallableRequest } from 'firebase-functions/v2/https'
import { onCall, HttpsError } from 'firebase-functions/v2/https'
import { getFirestore } from 'firebase-admin/firestore'
import { closeDay as closeDayCore } from './lib/closeDay.js'
import type { CloseDayInput } from './lib/closeDay.js'

function requireStaff(request: CallableRequest<unknown>): void {
  const token = request.auth?.token as Record<string, unknown> | undefined
  if (token?.staff !== true) {
    throw new HttpsError('permission-denied', 'Staff only.')
  }
}

export const closeDay = onCall<CloseDayInput>(async (request) => {
  requireStaff(request)
  try {
    return await closeDayCore(getFirestore(), (request.data ?? {}) as CloseDayInput)
  } catch (err) {
    throw new HttpsError('failed-precondition', (err as Error).message)
  }
})
