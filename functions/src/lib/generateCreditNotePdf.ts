import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import type { BuyerTerms, Cents, CreditNoteLine } from './types.js'
import type { BusinessConfig } from './types.js'

// ---------------------------------------------------------------------------
// Renders an already-issued credit note to PDF bytes. Deliberately near-
// identical to generateInvoicePdf.ts (plain Date rather than Timestamp, same
// "identical content, not necessarily identical bytes" caveat) — kept as its
// own small function rather than a shared one with branching, since a
// credit note's header differs (it references the invoice it reverses) and
// three similar functions are simpler to read than one with a mode flag.
// ---------------------------------------------------------------------------

export interface CreditNotePdfData {
  creditNoteNumber: number
  invoiceNumber: number
  issuedAt: Date
  business: BusinessConfig
  buyerName: string
  buyerTerms: BuyerTerms
  lines: CreditNoteLine[]
  subtotal: Cents
  taxRateBps: number
  tax: Cents
  total: Cents
}

function formatCents(cents: Cents): string {
  return `$${(cents / 100).toFixed(2)}`
}

const PAYMENT_TERMS_LABEL: Record<BuyerTerms, string> = {
  prepay: 'Prepay',
  net7: 'Net 7',
  net15: 'Net 15',
}

const PAGE_WIDTH = 612
const PAGE_HEIGHT = 792
const MARGIN = 54

export async function generateCreditNotePdf(data: CreditNotePdfData): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  doc.setTitle(`Credit Note ${data.creditNoteNumber}`)
  doc.setProducer('MobiSource')
  doc.setCreationDate(data.issuedAt)
  doc.setModificationDate(data.issuedAt)

  const page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT])
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)
  const black = rgb(0, 0, 0)
  const gray = rgb(0.4, 0.4, 0.4)

  let y = PAGE_HEIGHT - MARGIN

  function text(str: string, x: number, size: number, useFont = font, color = black) {
    page.drawText(str, { x, y, size, font: useFont, color })
  }

  function line(dy: number) {
    y -= dy
  }

  text(data.business.legalName, MARGIN, 16, bold)
  line(20)
  text(data.business.address, MARGIN, 10, font, gray)
  line(13)
  text(`${data.business.email} · ${data.business.phone}`, MARGIN, 10, font, gray)
  line(13)
  text(`HST #: ${data.business.hstNumber}`, MARGIN, 10, font, gray)

  const headerY = PAGE_HEIGHT - MARGIN
  page.drawText('CREDIT NOTE', { x: PAGE_WIDTH - MARGIN - 140, y: headerY, size: 16, font: bold, color: black })
  page.drawText(`No. ${data.creditNoteNumber}`, {
    x: PAGE_WIDTH - MARGIN - 140,
    y: headerY - 20,
    size: 10,
    font,
    color: gray,
  })
  page.drawText(`Credits invoice No. ${data.invoiceNumber}`, {
    x: PAGE_WIDTH - MARGIN - 140,
    y: headerY - 33,
    size: 10,
    font,
    color: gray,
  })
  page.drawText(`Date: ${data.issuedAt.toISOString().slice(0, 10)}`, {
    x: PAGE_WIDTH - MARGIN - 140,
    y: headerY - 46,
    size: 10,
    font,
    color: gray,
  })

  line(43)
  text('Credit to:', MARGIN, 10, bold)
  line(14)
  text(data.buyerName, MARGIN, 11, font)
  line(14)
  text(`Payment terms: ${PAYMENT_TERMS_LABEL[data.buyerTerms]}`, MARGIN, 10, font, gray)

  line(30)
  const colSku = MARGIN
  const colDesc = MARGIN + 130
  const colQty = PAGE_WIDTH - MARGIN - 190
  const colPrice = PAGE_WIDTH - MARGIN - 130
  const colTotal = PAGE_WIDTH - MARGIN - 60

  text('SKU', colSku, 10, bold)
  text('Description', colDesc, 10, bold)
  text('Qty', colQty, 10, bold)
  text('Unit price', colPrice, 10, bold)
  text('Line total', colTotal, 10, bold)
  line(6)
  page.drawLine({ start: { x: MARGIN, y }, end: { x: PAGE_WIDTH - MARGIN, y }, thickness: 0.5, color: gray })
  line(14)

  for (const creditLine of data.lines) {
    text(creditLine.skuCode, colSku, 8, font)
    text(creditLine.description, colDesc, 9, font)
    text(String(creditLine.qty), colQty, 9, font)
    text(formatCents(creditLine.unitPrice), colPrice, 9, font)
    text(formatCents(creditLine.lineTotal), colTotal, 9, font)
    line(16)
  }

  line(10)
  page.drawLine({ start: { x: MARGIN, y }, end: { x: PAGE_WIDTH - MARGIN, y }, thickness: 0.5, color: gray })
  line(20)

  const totalsLabelX = PAGE_WIDTH - MARGIN - 160
  const totalsValueX = PAGE_WIDTH - MARGIN - 60

  page.drawText('Subtotal credited', { x: totalsLabelX, y, size: 10, font, color: gray })
  page.drawText(formatCents(data.subtotal), { x: totalsValueX, y, size: 10, font, color: black })
  line(16)

  const taxLabel = data.taxRateBps > 0 ? `HST reversed (${data.taxRateBps / 100}%)` : 'Tax reversed'
  page.drawText(taxLabel, { x: totalsLabelX, y, size: 10, font, color: gray })
  page.drawText(formatCents(data.tax), { x: totalsValueX, y, size: 10, font, color: black })
  line(18)

  page.drawLine({
    start: { x: totalsLabelX, y: y + 16 },
    end: { x: PAGE_WIDTH - MARGIN, y: y + 16 },
    thickness: 0.5,
    color: gray,
  })
  page.drawText('Total credited', { x: totalsLabelX, y, size: 12, font: bold, color: black })
  page.drawText(formatCents(data.total), { x: totalsValueX, y, size: 12, font: bold, color: black })

  return doc.save()
}
