const CONDITIONS = ['A', 'B', 'C', 'D']
const SOURCES = ['local', 'china', 'trade-in']
const CURRENCIES = ['CAD', 'USD']

/**
 * Validates donor intake input per docs/SCHEMA.md §3. Throws on the first
 * problem found; callers should not attempt to partially apply the input.
 */
export function validateDonorIntake(data) {
  if (!Number.isInteger(data.purchaseCost) || data.purchaseCost < 0) {
    throw new Error('purchaseCost must be a non-negative integer (cents).')
  }
  if (!CONDITIONS.includes(data.condition)) {
    throw new Error(`condition must be one of ${CONDITIONS.join(', ')}.`)
  }
  if (!SOURCES.includes(data.source)) {
    throw new Error(`source must be one of ${SOURCES.join(', ')}.`)
  }
  if (!CURRENCIES.includes(data.purchaseCurrency)) {
    throw new Error(`purchaseCurrency must be one of ${CURRENCIES.join(', ')}.`)
  }
  if (data.purchaseCurrency !== 'CAD' && !(typeof data.fxRateUsed === 'number' && data.fxRateUsed > 0)) {
    throw new Error('fxRateUsed is required and must be a positive number when purchaseCurrency is not CAD.')
  }
  if (!data.imei && !(typeof data.imeiBlankReason === 'string' && data.imeiBlankReason.trim())) {
    throw new Error('imeiBlankReason is required when imei is blank.')
  }
}
