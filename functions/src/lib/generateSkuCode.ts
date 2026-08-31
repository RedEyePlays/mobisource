import type { Grade, PartType, Source } from './types.js'

// Fixed, short list per docs/SCHEMA.md §1 — keep it that way.
const PART_TYPES: readonly PartType[] = [
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

const GRADES: readonly Grade[] = ['A', 'B', 'C', 'N']
const SOURCES: readonly Source[] = ['PULL', 'AFT', 'OEM']
const MODEL_PATTERN = /^[A-Z0-9]+$/

function isPartType(value: string): value is PartType {
  return (PART_TYPES as readonly string[]).includes(value)
}

function isGrade(value: string): value is Grade {
  return (GRADES as readonly string[]).includes(value)
}

function isSource(value: string): value is Source {
  return (SOURCES as readonly string[]).includes(value)
}

export interface GenerateSkuCodeInput {
  partType: string
  model: string
  grade: string
  source: string
}

/**
 * Builds a SKU code from field values per docs/SCHEMA.md §1:
 * MS-{PART}-{MODEL}-{GRADE}-{SOURCE}. Never accept a typed code —
 * generate it, so a pull and an aftermarket part can never collide
 * (their SOURCE segment always differs).
 *
 * Fields are raw, untrusted strings (this is what validates them into the
 * known enums), not the already-narrowed PartType/Grade/Source types.
 */
export function generateSkuCode({ partType, model, grade, source }: GenerateSkuCodeInput): string {
  if (!isPartType(partType)) {
    throw new Error(`Unknown partType: ${partType}`)
  }
  if (!isGrade(grade)) {
    throw new Error(`Unknown grade: ${grade}`)
  }
  if (!isSource(source)) {
    throw new Error(`Unknown source: ${source}`)
  }
  if (typeof model !== 'string' || !MODEL_PATTERN.test(model)) {
    throw new Error(`Invalid model code: ${model}`)
  }

  return `MS-${partType}-${model}-${grade}-${source}`
}
