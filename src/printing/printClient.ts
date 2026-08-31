// Client for the local print service (print-service/, at the repo root) —
// a small HTTP server that runs on the same machine as the USB-attached
// Zebra ZD421, since the browser itself has no way to reach a USB printer.
// See print-service/README.md for the HTTP contract this mirrors.
//
// Printing is always a best-effort side action *after* the real write
// (performTeardown / receiveBulkShipment) has already succeeded — a caller
// should catch failures from these functions and show a dismissible
// warning, never treat a print failure as a reason to undo or block the
// business transaction that already committed.

const PRINT_SERVICE_URL = import.meta.env.VITE_PRINT_SERVICE_URL ?? 'http://localhost:9100'

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

interface PrintResponse {
  ok: boolean
  error?: string
}

async function postPrintJob(
  template: 'harvested' | 'bulk',
  fields: HarvestedLabelFields | BulkLabelFields,
  copies = 1,
): Promise<void> {
  let response: Response
  try {
    response = await fetch(`${PRINT_SERVICE_URL}/print`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ template, copies, fields }),
    })
  } catch {
    throw new Error('Could not reach the print service. Is it running on this machine?')
  }

  const body = (await response.json().catch(() => null)) as PrintResponse | null
  if (!response.ok || !body?.ok) {
    throw new Error(body?.error ?? `Print service returned ${response.status}.`)
  }
}

/** One harvested-part label — the QR encodes this specific stockItem's itemId. */
export function printHarvestedLabel(fields: HarvestedLabelFields): Promise<void> {
  return postPrintJob('harvested', fields)
}

/** `copies` identical bulk-part labels — the QR encodes skuCode, the same on every unit. */
export function printBulkLabels(fields: BulkLabelFields, copies: number): Promise<void> {
  return postPrintJob('bulk', fields, copies)
}
