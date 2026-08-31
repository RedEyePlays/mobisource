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
      <div className="p-6 max-w-lg">
        <h2 className="text-lg font-semibold mb-2">Shipping applied</h2>
        <p>
          {receipt.supplier} / {receipt.invoiceRef} landed costs updated.
        </p>
        {result.totalDiscrepancyCAD > 0 ? (
          <p className="text-yellow-700 mt-2">
            {formatCents(result.totalDiscrepancyCAD)} of shipping couldn't be absorbed — those units had already
            sold before this landed, and their recorded cost was left alone. See the receipt for the breakdown.
          </p>
        ) : (
          <p className="text-gray-600 mt-2">Every unit was still on hand — no discrepancy.</p>
        )}
        <button onClick={onDone} className="mt-4 bg-black text-white rounded px-3 py-2">
          Done
        </button>
      </div>
    )
  }

  return (
    <div className="p-6 max-w-2xl">
      <button onClick={onBack} className="text-gray-500 mb-2">
        ← Back to pending receipts
      </button>
      <h2 className="text-lg font-semibold mb-1">
        Apply shipping — {receipt.supplier} / {receipt.invoiceRef}
      </h2>
      <p className="text-gray-600 mb-4">FX rate captured at receiving: {receipt.fxRate}</p>

      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div className="flex gap-3">
          <select
            value={shippingCurrency}
            onChange={(e) => setShippingCurrency(e.target.value as PurchaseCurrency)}
            className="border rounded px-3 py-2"
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
            className="border rounded px-3 py-2 flex-1"
            required
          />
        </div>

        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="border-b">
              <th className="py-2 pr-4">SKU</th>
              <th className="py-2 pr-4">Qty</th>
              <th className="py-2 pr-4">Unit cost (CAD)</th>
              <th className="py-2 pr-4">Oversized override</th>
            </tr>
          </thead>
          <tbody>
            {receipt.lines.map((line) => {
              const override = overrides[line.skuCode]
              return (
                <tr key={line.skuCode} className="border-b">
                  <td className="py-2 pr-4 font-mono text-sm">{line.skuCode}</td>
                  <td className="py-2 pr-4">{line.qty}</td>
                  <td className="py-2 pr-4">{formatCents(line.unitCostCAD)}</td>
                  <td className="py-2 pr-4">
                    <label className="flex items-center gap-2 text-sm mb-1">
                      <input
                        type="checkbox"
                        checked={override.oversized}
                        onChange={(e) => updateOverride(line.skuCode, { oversized: e.target.checked })}
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
                          className="border rounded px-1 py-1 text-sm"
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
                          className="border rounded px-1 py-1 text-sm w-24"
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

        {error && <p className="text-red-600 text-sm">{error}</p>}

        <div className="flex gap-2">
          <button
            type="submit"
            disabled={submitting}
            className="bg-black text-white rounded px-3 py-2 disabled:opacity-50"
          >
            Apply shipping
          </button>
          <button type="button" onClick={onBack} className="border rounded px-3 py-2">
            Cancel
          </button>
        </div>
      </form>
    </div>
  )
}
