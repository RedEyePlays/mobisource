import type { CallableRequest } from 'firebase-functions/v2/https'
import { onCall, HttpsError } from 'firebase-functions/v2/https'
import { getFirestore } from 'firebase-admin/firestore'
import { createOrder as createOrderCore } from './lib/createOrder.js'
import type { CreateOrderInput } from './lib/createOrder.js'
import { confirmOrder as confirmOrderCore } from './lib/confirmOrder.js'
import type { ConfirmOrderInput } from './lib/confirmOrder.js'
import { cancelOrder as cancelOrderCore } from './lib/cancelOrder.js'
import type { CancelOrderInput } from './lib/cancelOrder.js'

function requireStaff(request: CallableRequest<unknown>): void {
  const token = request.auth?.token as Record<string, unknown> | undefined
  if (token?.staff !== true) {
    throw new HttpsError('permission-denied', 'Staff only.')
  }
}

export const createOrder = onCall<CreateOrderInput>(async (request) => {
  requireStaff(request)
  try {
    return await createOrderCore(getFirestore(), (request.data ?? {}) as CreateOrderInput)
  } catch (err) {
    throw new HttpsError('failed-precondition', (err as Error).message)
  }
})

export const confirmOrder = onCall<ConfirmOrderInput>(async (request) => {
  requireStaff(request)
  try {
    return await confirmOrderCore(getFirestore(), (request.data ?? {}) as ConfirmOrderInput)
  } catch (err) {
    throw new HttpsError('failed-precondition', (err as Error).message)
  }
})

export const cancelOrder = onCall<CancelOrderInput>(async (request) => {
  requireStaff(request)
  try {
    // A client only ever cancels explicitly — note is never accepted from
    // the caller, so a client can't impersonate the auto-expiry sweep's note.
    const { orderId } = (request.data ?? {}) as CancelOrderInput
    return await cancelOrderCore(getFirestore(), { orderId })
  } catch (err) {
    throw new HttpsError('failed-precondition', (err as Error).message)
  }
})
