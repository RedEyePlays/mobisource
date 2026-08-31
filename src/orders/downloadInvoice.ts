import { httpsCallable } from 'firebase/functions'
import { functions } from '../firebase'

interface GetInvoicePdfResult {
  invoiceNumber: number
  filename: string
  pdfBase64: string
}

// getInvoicePdf is idempotent — issueInvoice returns the same invoice doc
// (and this always regenerates identical PDF bytes from it) whether this is
// the first download or a re-download much later.
export async function downloadInvoicePdf(orderId: string): Promise<void> {
  const getInvoicePdf = httpsCallable<{ orderId: string }, GetInvoicePdfResult>(functions, 'getInvoicePdf')
  const result = await getInvoicePdf({ orderId })
  const { filename, pdfBase64 } = result.data

  const bytes = Uint8Array.from(atob(pdfBase64), (c) => c.charCodeAt(0))
  const blob = new Blob([bytes], { type: 'application/pdf' })
  const url = URL.createObjectURL(blob)
  try {
    const link = document.createElement('a')
    link.href = url
    link.download = filename
    document.body.appendChild(link)
    link.click()
    link.remove()
  } finally {
    URL.revokeObjectURL(url)
  }
}
