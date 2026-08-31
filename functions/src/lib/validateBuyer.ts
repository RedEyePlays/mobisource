import type { BuyerTaxStatus, BuyerTerms, BuyerTier, BuyerType } from './types.js'

const TYPES: readonly BuyerType[] = ['repairShop', 'broker', 'exporter', 'retail']
const TIERS: readonly BuyerTier[] = ['standard', 'preferred', 'partner']
const TERMS: readonly BuyerTerms[] = ['prepay', 'net7', 'net15']
const TAX_STATUSES: readonly BuyerTaxStatus[] = ['taxable', 'exempt', 'zeroRated']

function isBuyerType(value: unknown): value is BuyerType {
  return typeof value === 'string' && (TYPES as readonly string[]).includes(value)
}

function isBuyerTier(value: unknown): value is BuyerTier {
  return typeof value === 'string' && (TIERS as readonly string[]).includes(value)
}

function isBuyerTerms(value: unknown): value is BuyerTerms {
  return typeof value === 'string' && (TERMS as readonly string[]).includes(value)
}

export function isBuyerTaxStatus(value: unknown): value is BuyerTaxStatus {
  return typeof value === 'string' && (TAX_STATUSES as readonly string[]).includes(value)
}

export interface BuyerFieldsInput {
  name?: unknown
  type?: unknown
  tier?: unknown
  terms?: unknown
  contact?: unknown
  taxStatus?: unknown
}

/**
 * Validates buyer fields per docs/SCHEMA.md §3. With `requireAll`, checks
 * name/type/tier/terms are present and valid (for create). Without it,
 * checks only whichever fields are present (for a partial update) — a
 * caller must still ensure at least one field was actually submitted.
 */
export function validateBuyerFields(fields: BuyerFieldsInput, { requireAll = false } = {}): void {
  if (requireAll || 'name' in fields) {
    if (typeof fields.name !== 'string' || !fields.name.trim()) {
      throw new Error('name must be a non-empty string.')
    }
  }
  if (requireAll || 'type' in fields) {
    if (!isBuyerType(fields.type)) {
      throw new Error(`type must be one of ${TYPES.join(', ')}.`)
    }
  }
  if (requireAll || 'tier' in fields) {
    if (!isBuyerTier(fields.tier)) {
      throw new Error(`tier must be one of ${TIERS.join(', ')}.`)
    }
  }
  if (requireAll || 'terms' in fields) {
    if (!isBuyerTerms(fields.terms)) {
      throw new Error(`terms must be one of ${TERMS.join(', ')}.`)
    }
  }
  if ('contact' in fields) {
    if (typeof fields.contact !== 'object' || fields.contact === null || Array.isArray(fields.contact)) {
      throw new Error('contact must be an object.')
    }
  }
  // taxStatus defaults to 'taxable' (docs/SCHEMA.md §3) — never required by
  // requireAll, only validated when the caller actually supplied one.
  if ('taxStatus' in fields && fields.taxStatus !== undefined) {
    if (!isBuyerTaxStatus(fields.taxStatus)) {
      throw new Error(`taxStatus must be one of ${TAX_STATUSES.join(', ')}.`)
    }
  }
}
