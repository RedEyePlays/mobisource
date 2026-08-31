import type { CallableRequest } from 'firebase-functions/v2/https'
import { onCall, HttpsError } from 'firebase-functions/v2/https'
import { getFirestore } from 'firebase-admin/firestore'
import { adjustStock as adjustStockCore } from './lib/adjustStock.js'
import type { AdjustStockInput } from './lib/adjustStock.js'

function requireStaff(request: CallableRequest<unknown>): void {
  const token = request.auth?.token as Record<string, unknown> | undefined
  if (token?.staff !== true) {
    throw new HttpsError('permission-denied', 'Staff only.')
  }
}

export const adjustStock = onCall<AdjustStockInput>(async (request) => {
  requireStaff(request)
  try {
    return await adjustStockCore(getFirestore(), (request.data ?? {}) as AdjustStockInput)
  } catch (err) {
    throw new HttpsError('failed-precondition', (err as Error).message)
  }
})
