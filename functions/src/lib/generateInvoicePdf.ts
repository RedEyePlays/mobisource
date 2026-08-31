import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import type { BuyerTerms, Cents, InvoiceLine } from './types.js'
import type { BusinessConfig } from './types.js'

// ---------------------------------------------------------------------------
// Renders an already-issued invoice to PDF bytes. Deliberately takes plain
// data (issuedAt as a Date, not a Firestore Timestamp) rather than the
// stored Invoice doc directly, so this stays a pure, emulator-free unit —
// same reasoning as taxRate.ts. issueInvoice.ts converts before calling.
//
// Every value drawn here comes from the frozen invoice doc — nothing reads
// "now" (no generated-on-download stamp) — so calling this again later for
// the same invoice renders the identical content. Creation/modification
// dates are set explicitly from issuedAt for the same reason; pdf-lib's own
// internal object IDs are not guaranteed byte-identical run to run, so
// "identical document" here means identical rendered content, not
// necessarily an identical PDF binary.
// ---------------------------------------------------------------------------

export interface InvoicePdfData {
  invoiceNumber: number
  issuedAt: Date
  business: BusinessConfig
  buyerName: string
  buyerTerms: BuyerTerms
  lines: InvoiceLine[]
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

export async function generateInvoicePdf(data: InvoicePdfData): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  doc.setTitle(`Invoice ${data.invoiceNumber}`)
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

  // Header — business identity, invoice number
  text(data.business.legalName, MARGIN, 16, bold)
  line(20)
  text(data.business.address, MARGIN, 10, font, gray)
  line(13)
  text(`${data.business.email} · ${data.business.phone}`, MARGIN, 10, font, gray)
  line(13)
  text(`HST #: ${data.business.hstNumber}`, MARGIN, 10, font, gray)

  const invoiceLabelY = PAGE_HEIGHT - MARGIN
  page.drawText(`INVOICE`, { x: PAGE_WIDTH - MARGIN - 100, y: invoiceLabelY, size: 16, font: bold, color: black })
  page.drawText(`No. ${data.invoiceNumber}`, {
    x: PAGE_WIDTH - MARGIN - 100,
    y: invoiceLabelY - 20,
    size: 10,
    font,
    color: gray,
  })
  page.drawText(`Date: ${data.issuedAt.toISOString().slice(0, 10)}`, {
    x: PAGE_WIDTH - MARGIN - 100,
    y: invoiceLabelY - 33,
    size: 10,
    font,
    color: gray,
  })

  line(30)
  text('Bill to:', MARGIN, 10, bold)
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
  page.drawLine({
    start: { x: MARGIN, y },
    end: { x: PAGE_WIDTH - MARGIN, y },
    thickness: 0.5,
    color: gray,
  })
  line(14)

  for (const invoiceLine of data.lines) {
    text(invoiceLine.skuCode, colSku, 8, font)
    text(invoiceLine.description, colDesc, 9, font)
    text(String(invoiceLine.qty), colQty, 9, font)
    text(formatCents(invoiceLine.unitPrice), colPrice, 9, font)
    text(formatCents(invoiceLine.lineTotal), colTotal, 9, font)
    line(16)
  }

  line(10)
  page.drawLine({
    start: { x: MARGIN, y },
    end: { x: PAGE_WIDTH - MARGIN, y },
    thickness: 0.5,
    color: gray,
  })
  line(20)

  const totalsLabelX = PAGE_WIDTH - MARGIN - 160
  const totalsValueX = PAGE_WIDTH - MARGIN - 60

  page.drawText('Subtotal', { x: totalsLabelX, y, size: 10, font, color: gray })
  page.drawText(formatCents(data.subtotal), { x: totalsValueX, y, size: 10, font, color: black })
  line(16)

  const taxLabel = data.taxRateBps > 0 ? `HST (${data.taxRateBps / 100}%)` : 'Tax'
  page.drawText(taxLabel, { x: totalsLabelX, y, size: 10, font, color: gray })
  page.drawText(formatCents(data.tax), { x: totalsValueX, y, size: 10, font, color: black })
  line(18)

  page.drawLine({
    start: { x: totalsLabelX, y: y + 16 },
    end: { x: PAGE_WIDTH - MARGIN, y: y + 16 },
    thickness: 0.5,
    color: gray,
  })
  page.drawText('Total', { x: totalsLabelX, y, size: 12, font: bold, color: black })
  page.drawText(formatCents(data.total), { x: totalsValueX, y, size: 12, font: bold, color: black })

  return doc.save()
}
