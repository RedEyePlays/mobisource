import { useEffect, useState } from 'react'
import { collection, getDocs, query, where } from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { db, functions } from '../firebase'
import type { Buyer, Cents, OrderLine, StockItem } from '../types'

function formatCents(cents: Cents) {
  return `$${(cents / 100).toFixed(2)}`
}

interface CreateOrderResult {
  orderId: string
  subtotal: Cents
  tax: Cents
  total: Cents
  lines: OrderLine[]
}

interface ConfirmOrderResult {
  orderId: string
  status: string
}

type StockItemRow = StockItem & { id: string }

export default function OrderBuilder({ onDone }: { onDone: () => void }) {
  const [buyers, setBuyers] = useState<Buyer[]>([])
  const [items, setItems] = useState<StockItemRow[]>([])
  const [buyerId, setBuyerId] = useState('')
  const [selectedItemIds, setSelectedItemIds] = useState<string[]>([])
  const [quote, setQuote] = useState<CreateOrderResult | null>(null)
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    async function load() {
      const [buyersSnap, itemsSnap] = await Promise.all([
        getDocs(collection(db, 'buyers')),
        getDocs(query(collection(db, 'stockItems'), where('status', '==', 'inStock'))),
      ])
      setBuyers(buyersSnap.docs.map((d) => d.data() as Buyer))
      setItems(itemsSnap.docs.map((d) => ({ id: d.id, ...d.data() }) as StockItemRow))
    }
    load()
  }, [])

  function toggleItem(itemId: string) {
    setSelectedItemIds((ids) => (ids.includes(itemId) ? ids.filter((id) => id !== itemId) : [...ids, itemId]))
  }

  async function handleCreateQuote() {
    setError('')
    setSubmitting(true)
    try {
      const createOrder = httpsCallable<{ buyerId: string; itemIds: string[] }, CreateOrderResult>(
        functions,
        'createOrder',
      )
      const result = await createOrder({ buyerId, itemIds: selectedItemIds })
      setQuote(result.data)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setSubmitting(false)
    }
  }

  async function handleConfirm() {
    setError('')
    setSubmitting(true)
    try {
      const confirmOrder = httpsCallable<{ orderId: string }, ConfirmOrderResult>(functions, 'confirmOrder')
      await confirmOrder({ orderId: quote!.orderId })
      onDone()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setSubmitting(false)
    }
  }

  if (quote) {
    const margin = quote.lines.reduce((sum, line) => sum + (line.unitPrice - line.unitCost) * line.qty, 0)
    return (
      <div className="mx-auto max-w-lg p-4 sm:p-6">
        <h2 className="page-title mb-4">Review quote</h2>
        <div className="table-wrap mb-4">
          <table className="table-base">
            <thead>
              <tr>
                <th>SKU</th>
                <th>Price</th>
                <th>Cost</th>
              </tr>
            </thead>
            <tbody>
              {quote.lines.map((line) => (
                <tr key={line.itemId}>
                  <td className="font-mono text-sm">{line.skuCode}</td>
                  <td>{formatCents(line.unitPrice)}</td>
                  <td>{formatCents(line.unitCost)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="card mb-4 flex flex-col gap-3 p-4">
          <div className="flex items-center justify-between">
            <span className="text-muted text-sm">Subtotal:</span>
            <span className="num-md">{formatCents(quote.subtotal)}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-muted text-sm">Tax:</span>
            <span className="num-md">{formatCents(quote.tax)}</span>
          </div>
          <div className="flex items-center justify-between border-t border-slate-200 pt-3 dark:border-slate-800">
            <span className="section-title">Total:</span>
            <span className="num-hero">{formatCents(quote.total)}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-muted text-sm">Margin:</span>
            <span className="num-md">{formatCents(margin as Cents)}</span>
          </div>
        </div>

        {error && <p className="text-danger mb-4 text-sm">{error}</p>}

        <div className="flex flex-col gap-2 sm:flex-row">
          <button onClick={handleConfirm} disabled={submitting} className="btn-primary btn-block sm:w-auto">
            Confirm order
          </button>
          <button onClick={onDone} className="btn-secondary btn-block sm:w-auto">
            Cancel
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-lg p-4 sm:p-6">
      <h2 className="page-title mb-4">Build order</h2>

      <label className="field mb-4">
        Buyer
        <select value={buyerId} onChange={(e) => setBuyerId(e.target.value)} className="select">
          <option value="">Select a buyer…</option>
          {buyers.map((buyer) => (
            <option key={buyer.buyerId} value={buyer.buyerId}>
              {buyer.name} ({buyer.tier})
            </option>
          ))}
        </select>
      </label>

      <p className="section-title mb-2">In-stock items</p>
      {items.length === 0 ? (
        <p className="text-muted mb-4">No in-stock items.</p>
      ) : (
        <div className="card mb-4 p-3">
          <div className="table-wrap">
            <table className="table-base">
              <thead>
                <tr>
                  <th></th>
                  <th>SKU</th>
                  <th>Grade</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.id}>
                    <td>
                      <input
                        type="checkbox"
                        checked={selectedItemIds.includes(item.id)}
                        onChange={() => toggleItem(item.id)}
                        className="checkbox"
                      />
                    </td>
                    <td className="font-mono text-sm">{item.skuCode}</td>
                    <td>{item.grade}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {error && <p className="text-danger mb-4 text-sm">{error}</p>}

      <div className="flex flex-col gap-2 sm:flex-row">
        <button
          onClick={handleCreateQuote}
          disabled={submitting || !buyerId || selectedItemIds.length === 0}
          className="btn-primary btn-block sm:w-auto"
        >
          Create quote
        </button>
        <button onClick={onDone} className="btn-secondary btn-block sm:w-auto">
          Cancel
        </button>
      </div>
    </div>
  )
}
