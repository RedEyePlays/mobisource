// Fixed, short list per docs/SCHEMA.md §1 — keep it that way.
const PART_TYPES = [
  'SCRN',
  'LOGIC',
  'HOUSASM',
  'HOUS',
  'BGLS',
  'BATT',
  'CAMR',
  'CAMF',
  'CHRG',
  'NFC',
  'SPKR',
  'EARP',
  'PROX',
  'FLSH',
  'TAPT',
]

const GRADES = ['A', 'B', 'C', 'N']
const SOURCES = ['PULL', 'AFT', 'OEM']
const MODEL_PATTERN = /^[A-Z0-9]+$/

/**
 * Builds a SKU code from field values per docs/SCHEMA.md §1:
 * MS-{PART}-{MODEL}-{GRADE}-{SOURCE}. Never accept a typed code —
 * generate it, so a pull and an aftermarket part can never collide
 * (their SOURCE segment always differs).
 */
export function generateSkuCode({ partType, model, grade, source }) {
  if (!PART_TYPES.includes(partType)) {
    throw new Error(`Unknown partType: ${partType}`)
  }
  if (!GRADES.includes(grade)) {
    throw new Error(`Unknown grade: ${grade}`)
  }
  if (!SOURCES.includes(source)) {
    throw new Error(`Unknown source: ${source}`)
  }
  if (typeof model !== 'string' || !MODEL_PATTERN.test(model)) {
    throw new Error(`Invalid model code: ${model}`)
  }

  return `MS-${partType}-${model}-${grade}-${source}`
}
