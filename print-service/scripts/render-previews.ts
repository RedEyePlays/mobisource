// Renders SVG preview images of both label types, driven by the exact same
// layout constants the real ZPL uses (LABEL_LAYOUT, exported from src/zpl.ts)
// so the preview can't silently drift from what actually prints. This is a
// separate renderer from the ZPL itself — the printer draws the real QR
// code from raw ^BQ data, but there's no printer here to ask, so this uses
// the `qrcode` package's low-level `create()` encoder to get the same QR
// module matrix a scanner would see, and draws it as SVG rects rather than
// producing a PNG (which would need a native canvas library — see
// print-service/README.md's "Regenerating previews" section for why SVG
// was chosen). Run via `npm run render-previews`.
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import QRCode from 'qrcode'
import { bulkLabelZpl, harvestedLabelZpl, LABEL_LAYOUT } from '../src/zpl.js'
import type { BulkLabelFields, HarvestedLabelFields } from '../src/zpl.js'

const SCALE = 3 // pixels per ZPL dot, for a comfortably-sized on-screen preview
const QR_BOX_DOTS = LABEL_LAYOUT.heightDots - LABEL_LAYOUT.qrY * 2 // square QR area, symmetric top/bottom margin

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const OUT_DIR = path.resolve(__dirname, '../../docs/labels')

function escapeXml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

async function qrRectsSvg(data: string, xDots: number, yDots: number, boxDots: number): Promise<string> {
  const code = QRCode.create(data, { errorCorrectionLevel: 'M' })
  const size = code.modules.size
  const cell = boxDots / size
  const rects: string[] = []
  for (let row = 0; row < size; row++) {
    for (let col = 0; col < size; col++) {
      if (code.modules.data[row * size + col]) {
        const x = (xDots + col * cell) * SCALE
        const y = (yDots + row * cell) * SCALE
        rects.push(`<rect x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${(cell * SCALE + 0.5).toFixed(2)}" height="${(cell * SCALE + 0.5).toFixed(2)}" fill="#000"/>`)
      }
    }
  }
  return rects.join('')
}

function labelFrame(widthPx: number, heightPx: number, body: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${widthPx}" height="${heightPx}" viewBox="0 0 ${widthPx} ${heightPx}">
  <rect x="0" y="0" width="${widthPx}" height="${heightPx}" fill="#ffffff" stroke="#cbd5e1" stroke-width="2"/>
  ${body}
</svg>`
}

async function renderHarvestedPreview(fields: HarvestedLabelFields): Promise<string> {
  const { model, grade, skuCode, itemId } = fields
  const widthPx = LABEL_LAYOUT.widthDots * SCALE
  const heightPx = LABEL_LAYOUT.heightDots * SCALE
  const m = LABEL_LAYOUT.margin * SCALE

  const qr = await qrRectsSvg(itemId, LABEL_LAYOUT.qrX, LABEL_LAYOUT.qrY, QR_BOX_DOTS)

  const body = `
  <text x="${m}" y="60" font-family="Arial, Helvetica, sans-serif" font-weight="700" font-size="30">${escapeXml(model)}</text>
  <text x="${m}" y="92" font-family="Arial, Helvetica, sans-serif" font-size="20">Grade ${escapeXml(grade)}</text>
  <text x="${m}" y="120" font-family="'Courier New', monospace" font-size="16">${escapeXml(skuCode)}</text>
  ${qr}
  <text x="${(LABEL_LAYOUT.qrX) * SCALE}" y="${heightPx - 10}" font-family="Arial, Helvetica, sans-serif" font-size="11" fill="#64748b">QR: itemId</text>
  `
  return labelFrame(widthPx, heightPx, body)
}

async function renderBulkPreview(fields: BulkLabelFields): Promise<string> {
  const { model, grade, partType, skuCode } = fields
  const widthPx = LABEL_LAYOUT.widthDots * SCALE
  const heightPx = LABEL_LAYOUT.heightDots * SCALE
  const m = LABEL_LAYOUT.margin * SCALE

  const qr = await qrRectsSvg(skuCode, LABEL_LAYOUT.qrX, LABEL_LAYOUT.qrY, QR_BOX_DOTS)

  const body = `
  <text x="${m}" y="60" font-family="Arial, Helvetica, sans-serif" font-weight="700" font-size="30">${escapeXml(model)}</text>
  <text x="${m}" y="90" font-family="Arial, Helvetica, sans-serif" font-size="18">${escapeXml(partType)} · Grade ${escapeXml(grade)}</text>
  <text x="${m}" y="118" font-family="'Courier New', monospace" font-size="16">${escapeXml(skuCode)}</text>
  ${qr}
  <text x="${(LABEL_LAYOUT.qrX) * SCALE}" y="${heightPx - 10}" font-family="Arial, Helvetica, sans-serif" font-size="11" fill="#64748b">QR: skuCode — same on every unit</text>
  `
  return labelFrame(widthPx, heightPx, body)
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true })

  const harvestedFields: HarvestedLabelFields = {
    itemId: 'aB3xQ9zK7pL2mN8vR1cT',
    skuCode: 'MS-SCRN-IP14P-A-PULL',
    grade: 'A',
    model: 'IP14P',
  }
  const bulkFields: BulkLabelFields = {
    skuCode: 'MS-BATT-IP14P-N-AFT',
    model: 'IP14P',
    grade: 'N',
    partType: 'BATT',
  }

  const harvestedSvg = await renderHarvestedPreview(harvestedFields)
  const bulkSvg = await renderBulkPreview(bulkFields)

  await writeFile(path.join(OUT_DIR, 'harvested-label-preview.svg'), harvestedSvg, 'utf8')
  await writeFile(path.join(OUT_DIR, 'bulk-label-preview.svg'), bulkSvg, 'utf8')

  // Also drop the literal ZPL next to the previews, so it's obvious the
  // preview and the real print job come from the same field values.
  await writeFile(
    path.join(OUT_DIR, 'harvested-label-example.zpl'),
    harvestedLabelZpl(harvestedFields),
    'utf8',
  )
  await writeFile(path.join(OUT_DIR, 'bulk-label-example.zpl'), bulkLabelZpl(bulkFields, 25), 'utf8')

  console.log(`Wrote label previews + example ZPL to ${OUT_DIR}`)
}

main().catch((err) => {
  console.error(err)
  process.exitCode = 1
})
