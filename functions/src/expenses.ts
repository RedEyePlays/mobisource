import type { CallableRequest } from 'firebase-functions/v2/https'
import { onCall, HttpsError } from 'firebase-functions/v2/https'
import { getFirestore } from 'firebase-admin/firestore'
import { recordExpense as recordExpenseCore } from './lib/recordExpense.js'
import type { RecordExpenseInput } from './lib/recordExpense.js'

function requireStaff(request: CallableRequest<unknown>): void {
  const token = request.auth?.token as Record<string, unknown> | undefined
  if (token?.staff !== true) {
    throw new HttpsError('permission-denied', 'Staff only.')
  }
}

export const recordExpense = onCall<RecordExpenseInput>(async (request) => {
  requireStaff(request)
  try {
    return await recordExpenseCore(getFirestore(), (request.data ?? {}) as RecordExpenseInput)
  } catch (err) {
    throw new HttpsError('invalid-argument', (err as Error).message)
  }
})
