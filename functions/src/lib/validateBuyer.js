const TYPES = ['repairShop', 'broker', 'exporter', 'retail']
const TIERS = ['tier1', 'tier2', 'tier3']
const TERMS = ['prepay', 'net7', 'net15']

/**
 * Validates buyer fields per docs/SCHEMA.md §3. With `requireAll`, checks
 * name/type/tier/terms are present and valid (for create). Without it,
 * checks only whichever fields are present (for a partial update) — a
 * caller must still ensure at least one field was actually submitted.
 */
export function validateBuyerFields(fields, { requireAll = false } = {}) {
  if (requireAll || 'name' in fields) {
    if (typeof fields.name !== 'string' || !fields.name.trim()) {
      throw new Error('name must be a non-empty string.')
    }
  }
  if (requireAll || 'type' in fields) {
    if (!TYPES.includes(fields.type)) {
      throw new Error(`type must be one of ${TYPES.join(', ')}.`)
    }
  }
  if (requireAll || 'tier' in fields) {
    if (!TIERS.includes(fields.tier)) {
      throw new Error(`tier must be one of ${TIERS.join(', ')}.`)
    }
  }
  if (requireAll || 'terms' in fields) {
    if (!TERMS.includes(fields.terms)) {
      throw new Error(`terms must be one of ${TERMS.join(', ')}.`)
    }
  }
  if ('contact' in fields) {
    if (typeof fields.contact !== 'object' || fields.contact === null || Array.isArray(fields.contact)) {
      throw new Error('contact must be an object.')
    }
  }
}
