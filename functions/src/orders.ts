import type { CallableRequest } from 'firebase-functions/v2/https'
import { onCall, HttpsError } from 'firebase-functions/v2/https'
import { getFirestore } from 'firebase-admin/firestore'
import { createOrder as createOrderCore } from './lib/createOrder.js'
import type { CreateOrderInput } from './lib/createOrder.js'
import { confirmOrder as confirmOrderCore } from './lib/confirmOrder.js'
import type { ConfirmOrderInput } from './lib/confirmOrder.js'

function requireStaff(request: CallableRequest<unknown>): void {
  const token = request.auth?.token as Record<string, unknown> | undefined
  if (token?.staff !== true) {
    throw new HttpsError('permission-denied', 'Staff only.')
  }
}

export const createOrder = onCall<Partial<CreateOrderInput>>(async (request) => {
  requireStaff(request)
  try {
    return await createOrderCore(getFirestore(), (request.data ?? {}) as CreateOrderInput)
  } catch (err) {
    throw new HttpsError('failed-precondition', (err as Error).message)
  }
})

export const confirmOrder = onCall<Partial<ConfirmOrderInput>>(async (request) => {
  requireStaff(request)
  try {
    return await confirmOrderCore(getFirestore(), (request.data ?? {}) as ConfirmOrderInput)
  } catch (err) {
    throw new HttpsError('failed-precondition', (err as Error).message)
  }
})
