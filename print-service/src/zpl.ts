// ZPL label generation for a Zebra ZD421, 2" x 1" direct thermal labels at
// 203 dpi (8 dots/mm) — the printer's default resolution. If a unit's ZD421
// is the 300 dpi variant, DOTS_PER_INCH and every coordinate below would
// need to scale by 300/203; that's a per-unit config change, not something
// this service auto-detects (see README).
//
// Two label types (docs/SCHEMA.md's tracking modes, §2):
// - harvested: one per serialized stockItem. QR encodes the itemId (the
//   Firestore doc ID), since that's the only thing that uniquely identifies
//   a physical harvested part. Human-readable model/SKU/grade alongside it.
// - bulk: one SKU-level label, printed identically N times for a bulk
//   receiving line. QR encodes the skuCode instead — there's no per-unit
//   identity to encode for a bulk part (docs/SCHEMA.md §2: bulk items carry
//   qty + weighted-average cost, not per-unit records).

const DOTS_PER_INCH = 203
const LABEL_WIDTH_DOTS = 2 * DOTS_PER_INCH // 406
const LABEL_HEIGHT_DOTS = 1 * DOTS_PER_INCH // 203

const MARGIN = 16
const TEXT_COLUMN_WIDTH = 204 // leaves room for the QR column starting at x=236
const QR_X = 236
const QR_Y = 16
const QR_MAGNIFICATION = 4 // module cell size factor for ^BQ, model 2

export interface HarvestedLabelFields {
  itemId: string
  skuCode: string
  grade: string
  model: string
}

export interface BulkLabelFields {
  skuCode: string
  model: string
  grade: string
  partType: string
}

/**
 * ZPL treats `^` as its command prefix and `~` as its control-character
 * prefix — either one appearing inside an `^FD...^FS` data field would
 * corrupt the format. Our own data (SKU codes, Firestore auto-IDs, part
 * types) never legitimately contains them, so stripping rather than
 * escaping is safe and keeps the printer's own font tables intact.
 */
function zplSafe(value: string): string {
  return value.replace(/[\^~]/g, '').replace(/[\r\n]/g, ' ').trim()
}

function labelHeader(): string[] {
  return ['^XA', '^CI28', `^PW${LABEL_WIDTH_DOTS}`, `^LL${LABEL_HEIGHT_DOTS}`, '^LH0,0']
}

/** ^PQ (print quantity) must come right before ^XZ — this is how one ZPL format asks the printer itself to repeat a label, rather than the caller resending the same bytes N times. */
function labelFooter(copies: number): string[] {
  const qty = Math.max(1, Math.round(copies))
  return [`^PQ${qty}`, '^XZ']
}

function qrField(data: string): string {
  return `^FO${QR_X},${QR_Y}^BQN,2,${QR_MAGNIFICATION}^FDQA,${zplSafe(data)}^FS`
}

/**
 * Harvested part label: QR encodes itemId, plus model/SKU/grade as
 * human-readable text. One per created stockItem — see src/printing on the
 * frontend for the actual print trigger.
 */
export function harvestedLabelZpl(fields: HarvestedLabelFields, copies = 1): string {
  const { itemId, skuCode, grade, model } = fields
  return [
    ...labelHeader(),
    `^FO${MARGIN},14^A0N,32,32^FD${zplSafe(model)}^FS`,
    `^FO${MARGIN},52^A0N,22,22^FDGrade ${zplSafe(grade)}^FS`,
    `^FO${MARGIN},84^A0N,16,13^FB${TEXT_COLUMN_WIDTH},3,2,L,0^FD${zplSafe(skuCode)}^FS`,
    qrField(itemId),
    ...labelFooter(copies),
  ].join('\n')
}

/**
 * Bulk part label: same barcode (QR encoding skuCode) on every unit of a
 * batch. Printed N times — once per unit received — via the `copies`
 * argument's ^PQ, not N separate ZPL formats.
 */
export function bulkLabelZpl(fields: BulkLabelFields, copies = 1): string {
  const { skuCode, model, grade, partType } = fields
  return [
    ...labelHeader(),
    `^FO${MARGIN},14^A0N,32,32^FD${zplSafe(model)}^FS`,
    `^FO${MARGIN},52^A0N,20,20^FD${zplSafe(partType)} - Grade ${zplSafe(grade)}^FS`,
    `^FO${MARGIN},84^A0N,16,13^FB${TEXT_COLUMN_WIDTH},3,2,L,0^FD${zplSafe(skuCode)}^FS`,
    qrField(skuCode),
    ...labelFooter(copies),
  ].join('\n')
}

export const LABEL_LAYOUT = {
  dotsPerInch: DOTS_PER_INCH,
  widthDots: LABEL_WIDTH_DOTS,
  heightDots: LABEL_HEIGHT_DOTS,
  margin: MARGIN,
  textColumnWidth: TEXT_COLUMN_WIDTH,
  qrX: QR_X,
  qrY: QR_Y,
  qrMagnification: QR_MAGNIFICATION,
} as const
