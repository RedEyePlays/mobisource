import { useState } from 'react'
import type { FormEvent } from 'react'
import { httpsCallable } from 'firebase/functions'
import { functions } from '../firebase'
import type { BulkReceipt, Cents, PurchaseCurrency } from '../types'

const CURRENCIES: readonly PurchaseCurrency[] = ['CAD', 'USD']

function formatCents(cents: Cents) {
  return `$${(cents / 100).toFixed(2)}`
}

function dollarsToCents(value: string): number {
  return Math.round(Number(value) * 100)
}

interface OverrideState {
  oversized: boolean
  currency: PurchaseCurrency
  amount: string
}

interface ApplyResult {
  totalDiscrepancyCAD: Cents
}

export default function ApplyShippingForm({
  receipt,
  onBack,
  onDone,
}: {
  receipt: BulkReceipt
  onBack: () => void
  onDone: () => void
}) {
  const [shippingCurrency, setShippingCurrency] = useState<PurchaseCurrency>('CAD')
  const [shippingTotal, setShippingTotal] = useState('')
  const [overrides, setOverrides] = useState<Record<string, OverrideState>>(
    Object.fromEntries(receipt.lines.map((l) => [l.skuCode, { oversized: false, currency: 'CAD', amount: '' }])),
  )
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [result, setResult] = useState<ApplyResult | null>(null)

  function updateOverride(skuCode: string, patch: Partial<OverrideState>) {
    setOverrides((o) => ({ ...o, [skuCode]: { ...o[skuCode], ...patch } }))
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setSubmitting(true)
    try {
      const applyReceiptShipping = httpsCallable<unknown, ApplyResult>(functions, 'applyReceiptShipping')
      const lineOverrides = Object.entries(overrides)
        .filter(([, o]) => o.oversized)
        .map(([skuCode, o]) => ({ skuCode, currency: o.currency, amount: dollarsToCents(o.amount) }))

      const response = await applyReceiptShipping({
        receiptId: receipt.receiptId,
        shipping: { currency: shippingCurrency, total: dollarsToCents(shippingTotal) },
        lineOverrides,
      })
      setResult(response.data)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setSubmitting(false)
    }
  }

  if (result) {
    return (
      <div className="mx-auto max-w-lg p-4 sm:p-6">
        <h2 className="page-title mb-2">Shipping applied</h2>
        <p>
          {receipt.supplier} / {receipt.invoiceRef} landed costs updated.
        </p>
        {result.totalDiscrepancyCAD > 0 ? (
          <div className="banner-warning mt-3">
            {formatCents(result.totalDiscrepancyCAD)} of shipping couldn't be absorbed — those units had already
            sold before this landed, and their recorded cost was left alone. See the receipt for the breakdown.
          </div>
        ) : (
          <p className="text-muted mt-2">Every unit was still on hand — no discrepancy.</p>
        )}
        <button onClick={onDone} className="btn-primary mt-4">
          Done
        </button>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-2xl p-4 sm:p-6">
      <button onClick={onBack} className="text-muted mb-2">
        ← Back to pending receipts
      </button>
      <h2 className="page-title mb-1">
        Apply shipping — {receipt.supplier} / {receipt.invoiceRef}
      </h2>
      <p className="text-muted mb-4">FX rate captured at receiving: {receipt.fxRate}</p>

      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:gap-3">
          <select
            value={shippingCurrency}
            onChange={(e) => setShippingCurrency(e.target.value as PurchaseCurrency)}
            className="select sm:w-auto"
          >
            {CURRENCIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <input
            value={shippingTotal}
            onChange={(e) => setShippingTotal(e.target.value)}
            type="number"
            step="0.01"
            min="0"
            placeholder="Total shipping"
            className="input flex-1"
            required
          />
        </div>

        <div className="table-wrap">
          <table className="table-base">
            <thead>
              <tr>
                <th>SKU</th>
                <th>Qty</th>
                <th>Unit cost (CAD)</th>
                <th>Oversized override</th>
              </tr>
            </thead>
            <tbody>
              {receipt.lines.map((line) => {
                const override = overrides[line.skuCode]
                return (
                  <tr key={line.skuCode}>
                    <td className="font-mono text-sm">{line.skuCode}</td>
                    <td>{line.qty}</td>
                    <td className="num-md">{formatCents(line.unitCostCAD)}</td>
                    <td>
                      <label className="mb-1 flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={override.oversized}
                          onChange={(e) => updateOverride(line.skuCode, { oversized: e.target.checked })}
                          className="checkbox"
                        />
                        Flat per-unit
                      </label>
                      {override.oversized && (
                        <div className="flex gap-1">
                          <select
                            value={override.currency}
                            onChange={(e) =>
                              updateOverride(line.skuCode, { currency: e.target.value as PurchaseCurrency })
                            }
                            className="select w-auto min-h-9 py-1 text-sm"
                          >
                            {CURRENCIES.map((c) => (
                              <option key={c} value={c}>
                                {c}
                              </option>
                            ))}
                          </select>
                          <input
                            value={override.amount}
                            onChange={(e) => updateOverride(line.skuCode, { amount: e.target.value })}
                            type="number"
                            min="0"
                            step="0.01"
                            className="input min-h-9 w-24 py-1 text-sm"
                            required={override.oversized}
                          />
                        </div>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        {error && <p className="banner-danger">{error}</p>}

        <div className="flex flex-col gap-2 sm:flex-row">
          <button type="submit" disabled={submitting} className="btn-primary">
            Apply shipping
          </button>
          <button type="button" onClick={onBack} className="btn-secondary">
            Cancel
          </button>
        </div>
      </form>
    </div>
  )
}
