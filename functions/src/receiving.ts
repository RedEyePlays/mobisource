import type { CallableRequest } from 'firebase-functions/v2/https'
import { onCall, HttpsError } from 'firebase-functions/v2/https'
import { getFirestore } from 'firebase-admin/firestore'
import { receiveBulkShipment as receiveBulkShipmentCore } from './lib/receiveBulkShipment.js'
import type { ReceiveBulkShipmentInput } from './lib/receiveBulkShipment.js'
import { applyReceiptShipping as applyReceiptShippingCore } from './lib/applyReceiptShipping.js'
import type { ApplyReceiptShippingInput } from './lib/applyReceiptShipping.js'

function requireStaff(request: CallableRequest<unknown>): void {
  const token = request.auth?.token as Record<string, unknown> | undefined
  if (token?.staff !== true) {
    throw new HttpsError('permission-denied', 'Staff only.')
  }
}

export const receiveBulkShipment = onCall<ReceiveBulkShipmentInput>(async (request) => {
  requireStaff(request)
  try {
    return await receiveBulkShipmentCore(getFirestore(), request.data)
  } catch (err) {
    throw new HttpsError('failed-precondition', (err as Error).message)
  }
})

export const applyReceiptShipping = onCall<ApplyReceiptShippingInput>(async (request) => {
  requireStaff(request)
  try {
    return await applyReceiptShippingCore(getFirestore(), request.data)
  } catch (err) {
    throw new HttpsError('failed-precondition', (err as Error).message)
  }
})
