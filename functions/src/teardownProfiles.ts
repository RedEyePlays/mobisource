import type { CallableRequest } from 'firebase-functions/v2/https'
import { onCall, HttpsError } from 'firebase-functions/v2/https'
import { getFirestore } from 'firebase-admin/firestore'
import {
  createTeardownProfile as createTeardownProfileCore,
  updateTeardownProfile as updateTeardownProfileCore,
  deleteTeardownProfile as deleteTeardownProfileCore,
} from './lib/teardownProfiles.js'
import type {
  CreateTeardownProfileInput,
  UpdateTeardownProfileInput,
  DeleteTeardownProfileInput,
} from './lib/teardownProfiles.js'

function requireStaff(request: CallableRequest<unknown>): void {
  const token = request.auth?.token as Record<string, unknown> | undefined
  if (token?.staff !== true) {
    throw new HttpsError('permission-denied', 'Staff only.')
  }
}

export const createTeardownProfile = onCall<CreateTeardownProfileInput>(async (request) => {
  requireStaff(request)
  try {
    return await createTeardownProfileCore(getFirestore(), request.data ?? {})
  } catch (err) {
    throw new HttpsError('invalid-argument', (err as Error).message)
  }
})

export const updateTeardownProfile = onCall<UpdateTeardownProfileInput>(async (request) => {
  requireStaff(request)
  try {
    return await updateTeardownProfileCore(getFirestore(), request.data ?? {})
  } catch (err) {
    throw new HttpsError('invalid-argument', (err as Error).message)
  }
})

export const deleteTeardownProfile = onCall<DeleteTeardownProfileInput>(async (request) => {
  requireStaff(request)
  try {
    return await deleteTeardownProfileCore(getFirestore(), request.data ?? {})
  } catch (err) {
    throw new HttpsError('invalid-argument', (err as Error).message)
  }
})
