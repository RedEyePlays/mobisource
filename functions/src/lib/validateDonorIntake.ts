import type { DonorCondition, DonorSource, PurchaseCurrency } from './types.js'

const CONDITIONS: readonly DonorCondition[] = ['A', 'B', 'C', 'D']
const SOURCES: readonly DonorSource[] = ['local', 'china', 'trade-in']
const CURRENCIES: readonly PurchaseCurrency[] = ['CAD', 'USD']

function isDonorCondition(value: unknown): value is DonorCondition {
  return typeof value === 'string' && (CONDITIONS as readonly string[]).includes(value)
}

function isDonorSource(value: unknown): value is DonorSource {
  return typeof value === 'string' && (SOURCES as readonly string[]).includes(value)
}

function isPurchaseCurrency(value: unknown): value is PurchaseCurrency {
  return typeof value === 'string' && (CURRENCIES as readonly string[]).includes(value)
}

export interface DonorIntakeInput {
  purchaseCost?: unknown
  condition?: unknown
  source?: unknown
  purchaseCurrency?: unknown
  fxRateUsed?: unknown
  imei?: unknown
  imeiBlankReason?: unknown
}

/**
 * Validates donor intake input per docs/SCHEMA.md §3. Throws on the first
 * problem found; callers should not attempt to partially apply the input.
 */
export function validateDonorIntake(data: DonorIntakeInput): void {
  if (!Number.isInteger(data.purchaseCost) || (data.purchaseCost as number) < 0) {
    throw new Error('purchaseCost must be a non-negative integer (cents).')
  }
  if (!isDonorCondition(data.condition)) {
    throw new Error(`condition must be one of ${CONDITIONS.join(', ')}.`)
  }
  if (!isDonorSource(data.source)) {
    throw new Error(`source must be one of ${SOURCES.join(', ')}.`)
  }
  if (!isPurchaseCurrency(data.purchaseCurrency)) {
    throw new Error(`purchaseCurrency must be one of ${CURRENCIES.join(', ')}.`)
  }
  if (data.purchaseCurrency !== 'CAD' && !(typeof data.fxRateUsed === 'number' && data.fxRateUsed > 0)) {
    throw new Error('fxRateUsed is required and must be a positive number when purchaseCurrency is not CAD.')
  }
  if (!data.imei && !(typeof data.imeiBlankReason === 'string' && data.imeiBlankReason.trim())) {
    throw new Error('imeiBlankReason is required when imei is blank.')
  }
}
