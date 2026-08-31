import { useState } from 'react'
import { httpsCallable } from 'firebase/functions'
import { functions } from '../firebase'
import { downloadCreditNotePdf } from './downloadCreditNote'
import type { Cents, OrderLine, ReturnDisposition, ReturnReason, SalesOrder } from '../types'

const REASONS: readonly ReturnReason[] = ['DOA', 'wrongPart', 'changedMind']
const DISPOSITIONS: readonly ReturnDisposition[] = ['restock', 'writeOff']

interface LineState {
  qty: number
  reason: ReturnReason
  disposition: ReturnDisposition
}

interface ProcessReturnResult {
  returnId: string
  creditNoteNumber: number
  subtotal: Cents
  tax: Cents
  total: Cents
}

function formatCents(cents: Cents) {
  return `$${(cents / 100).toFixed(2)}`
}

function lineKey(line: OrderLine): string {
  return line.itemId ?? line.skuCode
}

export default function ReturnForm({ order, onDone }: { order: SalesOrder; onDone: () => void }) {
  const [lineState, setLineState] = useState<Record<string, LineState>>(
    Object.fromEntries(order.lines.map((line) => [lineKey(line), { qty: 0, reason: 'DOA', disposition: 'restock' }])),
  )
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [result, setResult] = useState<ProcessReturnResult | null>(null)
  const [downloading, setDownloading] = useState(false)

  function updateLine(key: string, patch: Partial<LineState>) {
    setLineState((s) => ({ ...s, [key]: { ...s[key], ...patch } }))
  }

  async function handleSubmit() {
    setError('')
    const lines = order.lines
      .map((line) => ({ line, state: lineState[lineKey(line)] }))
      .filter(({ state }) => state.qty > 0)
      .map(({ line, state }) => ({
        skuCode: line.skuCode,
        ...(line.itemId ? { itemId: line.itemId } : {}),
        qty: state.qty,
        reason: state.reason,
        disposition: state.disposition,
      }))

    if (lines.length === 0) {
      setError('Enter a return quantity for at least one line.')
      return
    }

    setSubmitting(true)
    try {
      const processReturn = httpsCallable<{ orderId: string; lines: unknown }, ProcessReturnResult>(
        functions,
        'processReturn',
      )
      const response = await processReturn({ orderId: order.orderId, lines })
      setResult(response.data)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setSubmitting(false)
    }
  }

  async function handleDownload() {
    if (!result) return
    setDownloading(true)
    try {
      await downloadCreditNotePdf(result.returnId)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setDownloading(false)
    }
  }

  if (result) {
    return (
      <div className="mx-auto max-w-lg p-4 sm:p-6">
        <h2 className="page-title mb-4">Return processed</h2>
        <div className="card mb-4 flex flex-col gap-3 p-4">
          <div className="flex items-center justify-between">
            <span className="text-muted text-sm">Credit note</span>
            <span className="num-md">#{result.creditNoteNumber}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-muted text-sm">Subtotal credited</span>
            <span className="num-md">{formatCents(result.subtotal)}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-muted text-sm">Tax reversed</span>
            <span className="num-md">{formatCents(result.tax)}</span>
          </div>
          <div className="flex items-center justify-between border-t border-slate-200 pt-3 dark:border-slate-800">
            <span className="section-title">Total credited</span>
            <span className="num-hero">{formatCents(result.total)}</span>
          </div>
        </div>

        {error && <p className="banner-danger mb-4">{error}</p>}

        <div className="flex flex-col gap-2 sm:flex-row">
          <button disabled={downloading} onClick={() => void handleDownload()} className="btn-primary btn-block sm:w-auto">
            {downloading ? '…' : 'Download credit note'}
          </button>
          <button onClick={onDone} className="btn-secondary btn-block sm:w-auto">
            Done
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-2xl p-4 sm:p-6">
      <h2 className="page-title mb-4">Process a return — order {order.orderId}</h2>

      <div className="table-wrap mb-4">
        <table className="table-base">
          <thead>
            <tr>
              <th>SKU</th>
              <th>Sold qty</th>
              <th>Return qty</th>
              <th>Reason</th>
              <th>Disposition</th>
            </tr>
          </thead>
          <tbody>
            {order.lines.map((line) => {
              const key = lineKey(line)
              const state = lineState[key]
              return (
                <tr key={key}>
                  <td className="font-mono text-sm">
                    {line.skuCode}
                    {line.itemId && <div className="text-muted text-xs">{line.itemId}</div>}
                  </td>
                  <td>{line.qty}</td>
                  <td>
                    <input
                      type="number"
                      min={0}
                      max={line.qty}
                      value={state.qty}
                      onChange={(e) => updateLine(key, { qty: Math.max(0, Math.min(line.qty, Number(e.target.value))) })}
                      className="input min-h-9 w-20 py-1 text-sm"
                    />
                  </td>
                  <td>
                    <select
                      value={state.reason}
                      onChange={(e) => updateLine(key, { reason: e.target.value as ReturnReason })}
                      className="select min-h-9 py-1 text-sm"
                      disabled={state.qty === 0}
                    >
                      {REASONS.map((r) => (
                        <option key={r} value={r}>
                          {r}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <select
                      value={state.disposition}
                      onChange={(e) => updateLine(key, { disposition: e.target.value as ReturnDisposition })}
                      className="select min-h-9 py-1 text-sm"
                      disabled={state.qty === 0}
                    >
                      {DISPOSITIONS.map((d) => (
                        <option key={d} value={d}>
                          {d}
                        </option>
                      ))}
                    </select>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {error && <p className="banner-danger mb-4">{error}</p>}

      <div className="flex flex-col gap-2 sm:flex-row">
        <button disabled={submitting} onClick={() => void handleSubmit()} className="btn-primary btn-block sm:w-auto">
          {submitting ? '…' : 'Process return'}
        </button>
        <button onClick={onDone} className="btn-secondary btn-block sm:w-auto">
          Cancel
        </button>
      </div>
    </div>
  )
}
