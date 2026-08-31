import { httpsCallable } from 'firebase/functions'
import { functions } from '../firebase'

interface GetCreditNotePdfResult {
  creditNoteNumber: number
  filename: string
  pdfBase64: string
}

export async function downloadCreditNotePdf(returnId: string): Promise<void> {
  const getCreditNotePdf = httpsCallable<{ returnId: string }, GetCreditNotePdfResult>(functions, 'getCreditNotePdf')
  const result = await getCreditNotePdf({ returnId })
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
