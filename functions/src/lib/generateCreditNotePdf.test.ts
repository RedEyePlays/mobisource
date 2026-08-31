import { describe, expect, it } from 'vitest'
import { generateCreditNotePdf } from './generateCreditNotePdf.js'
import { cents } from './types.js'
import type { CreditNotePdfData } from './generateCreditNotePdf.js'

const BASE: CreditNotePdfData = {
  creditNoteNumber: 1,
  invoiceNumber: 1,
  issuedAt: new Date('2026-09-02T12:00:00Z'),
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

describe('generateCreditNotePdf', () => {
  it('produces a well-formed, non-trivial PDF', async () => {
    const bytes = await generateCreditNotePdf(BASE)
    expect(bytes.length).toBeGreaterThan(500)
    expect(Buffer.from(bytes.slice(0, 5)).toString('utf8')).toBe('%PDF-')
  })

  it('renders a $0 tax credit note without throwing', async () => {
    const bytes = await generateCreditNotePdf({ ...BASE, taxRateBps: 0, tax: cents(0), total: BASE.subtotal })
    expect(bytes.length).toBeGreaterThan(500)
  })
})
