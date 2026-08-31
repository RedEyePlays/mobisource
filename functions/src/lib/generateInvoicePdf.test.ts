import { describe, expect, it } from 'vitest'
import { generateInvoicePdf } from './generateInvoicePdf.js'
import { cents } from './types.js'
import type { InvoicePdfData } from './generateInvoicePdf.js'

const BASE: InvoicePdfData = {
  invoiceNumber: 1,
  issuedAt: new Date('2026-08-31T12:00:00Z'),
  business: {
    legalName: 'MobiSource Inc.',
    address: '123 Repair Lane, Brampton, ON L6T 0A1',
    email: 'accounts@mobisource.example',
    phone: '(555) 555-0100',
    hstNumber: '123456789 RT0001',
  },
  buyerName: 'Test Buyer',
  buyerTerms: 'net15',
  lines: [
    { skuCode: 'MS-SCRN-IP14P-A-PULL', description: 'SCRN · IP14P · Grade A', qty: 1, unitPrice: cents(24000), lineTotal: cents(24000) },
  ],
  subtotal: cents(24000),
  taxRateBps: 1300,
  tax: cents(3120),
  total: cents(27120),
}

describe('generateInvoicePdf', () => {
  it('produces a well-formed, non-trivial PDF', async () => {
    const bytes = await generateInvoicePdf(BASE)
    expect(bytes.length).toBeGreaterThan(500)
    const header = Buffer.from(bytes.slice(0, 5)).toString('utf8')
    expect(header).toBe('%PDF-')
  })

  it('produces the same byte length for identical input, called twice', async () => {
    const a = await generateInvoicePdf(BASE)
    const b = await generateInvoicePdf(BASE)
    expect(a.length).toBe(b.length)
  })

  it('renders a $0 tax invoice (exempt/zeroRated buyer) without throwing', async () => {
    const bytes = await generateInvoicePdf({ ...BASE, taxRateBps: 0, tax: cents(0), total: BASE.subtotal })
    expect(bytes.length).toBeGreaterThan(500)
  })

  it('renders multiple line items', async () => {
    const bytes = await generateInvoicePdf({
      ...BASE,
      lines: [
        ...BASE.lines,
        { skuCode: 'MS-BATT-IP14P-N-AFT', description: 'BATT · IP14P · Grade N', qty: 3, unitPrice: cents(1800), lineTotal: cents(5400) },
      ],
    })
    expect(bytes.length).toBeGreaterThan(500)
  })
})
