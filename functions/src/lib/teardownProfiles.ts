import type { Firestore, WithFieldValue } from 'firebase-admin/firestore'
import type { ExpectedPart, TeardownProfile, TeardownProfileGrade } from './types.js'

const GRADES: readonly TeardownProfileGrade[] = ['AB', 'CD']
// Same convention as generateSkuCode.ts's model pattern — profileId is
// `${model}-${donorGrade}`, so model itself can never contain a dash.
const MODEL_PATTERN = /^[A-Z0-9]+$/

function isGrade(value: unknown): value is TeardownProfileGrade {
  return typeof value === 'string' && (GRADES as readonly string[]).includes(value)
}

interface RawExpectedPart {
  skuCode?: unknown
  likelihood?: unknown
}

/**
 * Validates and normalizes expectedParts, shared by create and update.
 * Requires at least one part, no duplicate skuCodes, and every skuCode to
 * already exist as a SKU — a typo here would otherwise surface only much
 * later, mid-transaction, the next time someone actually tears down a
 * donor against this profile (see teardownDonor.ts's "SKU not found").
 */
async function validateExpectedParts(db: Firestore, parts: unknown): Promise<ExpectedPart[]> {
  if (!Array.isArray(parts) || parts.length === 0) {
    throw new Error('expectedParts must be a non-empty array.')
  }

  const seen = new Set<string>()
  const normalized: ExpectedPart[] = []
  for (const raw of parts as RawExpectedPart[]) {
    const skuCode = typeof raw.skuCode === 'string' ? raw.skuCode.trim() : ''
    if (!skuCode) {
      throw new Error('Each expected part needs a skuCode.')
    }
    if (seen.has(skuCode)) {
      throw new Error(`Duplicate skuCode in expectedParts: ${skuCode}`)
    }
    seen.add(skuCode)

    const likelihood = raw.likelihood
    if (typeof likelihood !== 'number' || !Number.isFinite(likelihood) || likelihood < 0 || likelihood > 1) {
      throw new Error(`likelihood for ${skuCode} must be a number between 0 and 1.`)
    }

    normalized.push({ skuCode, likelihood })
  }

  const skuSnaps = await db.getAll(...normalized.map((p) => db.collection('skus').doc(p.skuCode)))
  const missing = skuSnaps.filter((snap) => !snap.exists).map((snap) => snap.id)
  if (missing.length > 0) {
    throw new Error(`Unknown skuCode(s): ${missing.join(', ')}`)
  }

  return normalized
}

function validateModel(model: unknown): string {
  if (typeof model !== 'string' || !MODEL_PATTERN.test(model)) {
    throw new Error(`Invalid model code: ${model}`)
  }
  return model
}

export interface CreateTeardownProfileInput {
  model?: unknown
  donorGrade?: unknown
  expectedParts?: unknown
}

export interface UpdateTeardownProfileInput {
  profileId?: unknown
  expectedParts?: unknown
}

export interface DeleteTeardownProfileInput {
  profileId?: unknown
}

export async function createTeardownProfile(
  db: Firestore,
  input: CreateTeardownProfileInput,
): Promise<{ profileId: string }> {
  const model = validateModel(input.model)
  if (!isGrade(input.donorGrade)) {
    throw new Error(`Invalid donorGrade: ${input.donorGrade}`)
  }
  const donorGrade = input.donorGrade
  const expectedParts = await validateExpectedParts(db, input.expectedParts)

  const profileId = `${model}-${donorGrade}`
  const ref = db.collection('teardownProfiles').doc(profileId)
  const existing = await ref.get()
  if (existing.exists) {
    throw new Error(`${profileId} already exists.`)
  }

  const profile: WithFieldValue<TeardownProfile> = { profileId, model, donorGrade, expectedParts }
  await ref.set(profile)

  return { profileId }
}

export async function updateTeardownProfile(
  db: Firestore,
  input: UpdateTeardownProfileInput,
): Promise<{ profileId: string }> {
  if (typeof input.profileId !== 'string' || !input.profileId) {
    throw new Error('profileId is required.')
  }
  const profileId = input.profileId
  const expectedParts = await validateExpectedParts(db, input.expectedParts)

  const ref = db.collection('teardownProfiles').doc(profileId)
  const existing = await ref.get()
  if (!existing.exists) {
    throw new Error(`${profileId} not found.`)
  }

  await ref.update({ expectedParts })
  return { profileId }
}

export async function deleteTeardownProfile(
  db: Firestore,
  input: DeleteTeardownProfileInput,
): Promise<{ profileId: string }> {
  if (typeof input.profileId !== 'string' || !input.profileId) {
    throw new Error('profileId is required.')
  }
  const profileId = input.profileId

  const ref = db.collection('teardownProfiles').doc(profileId)
  const existing = await ref.get()
  if (!existing.exists) {
    throw new Error(`${profileId} not found.`)
  }

  await ref.delete()
  return { profileId }
}
