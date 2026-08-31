import type { CallableRequest } from 'firebase-functions/v2/https'
import { onCall, HttpsError } from 'firebase-functions/v2/https'
import { getFirestore } from 'firebase-admin/firestore'
import { issueInvoice } from './lib/issueInvoice.js'
import { generateInvoicePdf } from './lib/generateInvoicePdf.js'

function requireStaff(request: CallableRequest<unknown>): void {
  const token = request.auth?.token as Record<string, unknown> | undefined
  if (token?.staff !== true) {
    throw new HttpsError('permission-denied', 'Staff only.')
  }
}

export interface GetInvoicePdfInput {
  orderId?: unknown
}

export const getInvoicePdf = onCall<GetInvoicePdfInput>(async (request) => {
  requireStaff(request)
  const orderId = request.data?.orderId
  if (typeof orderId !== 'string' || !orderId) {
    throw new HttpsError('invalid-argument', 'orderId is required.')
  }

  try {
    const db = getFirestore()
    const invoice = await issueInvoice(db, { orderId })
    const pdfBytes = await generateInvoicePdf({
      invoiceNumber: invoice.invoiceNumber,
      issuedAt: invoice.issuedAt.toDate(),
      business: invoice.business,
      buyerName: invoice.buyerName,
      buyerTerms: invoice.buyerTerms,
      lines: invoice.lines,
      subtotal: invoice.subtotal,
      taxRateBps: invoice.taxRateBps,
      tax: invoice.tax,
      total: invoice.total,
    })

    return {
      invoiceNumber: invoice.invoiceNumber,
      filename: `invoice-${String(invoice.invoiceNumber).padStart(6, '0')}.pdf`,
      pdfBase64: Buffer.from(pdfBytes).toString('base64'),
    }
  } catch (err) {
    throw new HttpsError('failed-precondition', (err as Error).message)
  }
})
