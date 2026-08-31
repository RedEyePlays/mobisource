import type { CallableRequest } from 'firebase-functions/v2/https'
import { onCall, HttpsError } from 'firebase-functions/v2/https'
import { getFirestore } from 'firebase-admin/firestore'
import { processReturn as processReturnCore } from './lib/processReturn.js'
import type { ProcessReturnInput } from './lib/processReturn.js'
import { generateCreditNotePdf } from './lib/generateCreditNotePdf.js'
import type { CreditNote } from './lib/types.js'

function requireStaff(request: CallableRequest<unknown>): void {
  const token = request.auth?.token as Record<string, unknown> | undefined
  if (token?.staff !== true) {
    throw new HttpsError('permission-denied', 'Staff only.')
  }
}

export const processReturn = onCall<ProcessReturnInput>(async (request) => {
  requireStaff(request)
  try {
    return await processReturnCore(getFirestore(), (request.data ?? {}) as ProcessReturnInput)
  } catch (err) {
    throw new HttpsError('failed-precondition', (err as Error).message)
  }
})

export interface GetCreditNotePdfInput {
  returnId?: unknown
}

export const getCreditNotePdf = onCall<GetCreditNotePdfInput>(async (request) => {
  requireStaff(request)
  const returnId = request.data?.returnId
  if (typeof returnId !== 'string' || !returnId) {
    throw new HttpsError('invalid-argument', 'returnId is required.')
  }

  try {
    const db = getFirestore()
    const snap = await db.collection('creditNotes').doc(returnId).get()
    if (!snap.exists) {
      throw new Error(`Credit note not found for return: ${returnId}`)
    }
    const creditNote = snap.data() as CreditNote

    const pdfBytes = await generateCreditNotePdf({
      creditNoteNumber: creditNote.creditNoteNumber,
      invoiceNumber: creditNote.invoiceNumber,
      issuedAt: creditNote.issuedAt.toDate(),
      business: creditNote.business,
      buyerName: creditNote.buyerName,
      buyerTerms: creditNote.buyerTerms,
      lines: creditNote.lines,
      subtotal: creditNote.subtotal,
      taxRateBps: creditNote.taxRateBps,
      tax: creditNote.tax,
      total: creditNote.total,
    })

    return {
      creditNoteNumber: creditNote.creditNoteNumber,
      filename: `credit-note-${String(creditNote.creditNoteNumber).padStart(6, '0')}.pdf`,
      pdfBase64: Buffer.from(pdfBytes).toString('base64'),
    }
  } catch (err) {
    throw new HttpsError('failed-precondition', (err as Error).message)
  }
})
