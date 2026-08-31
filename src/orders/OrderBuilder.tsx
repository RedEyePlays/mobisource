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
    const margin = quote.lines.reduce((sum, line) => sum + (line.unitPrice - line.unitCost), 0)
    return (
      <div className="p-6 max-w-lg">
        <h2 className="text-lg font-semibold mb-4">Review quote</h2>
        <table className="w-full text-left border-collapse mb-4">
          <thead>
            <tr className="border-b">
              <th className="py-2 pr-4">SKU</th>
              <th className="py-2 pr-4">Price</th>
              <th className="py-2 pr-4">Cost</th>
            </tr>
          </thead>
          <tbody>
            {quote.lines.map((line) => (
              <tr key={line.itemId} className="border-b">
                <td className="py-2 pr-4 font-mono text-sm">{line.skuCode}</td>
                <td className="py-2 pr-4">{formatCents(line.unitPrice)}</td>
                <td className="py-2 pr-4">{formatCents(line.unitCost)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p>Subtotal: {formatCents(quote.subtotal)}</p>
        <p>Tax: {formatCents(quote.tax)}</p>
        <p className="font-semibold">Total: {formatCents(quote.total)}</p>
        <p className="text-gray-500 text-sm mb-4">Margin: {formatCents(margin as Cents)}</p>

        {error && <p className="text-red-600 text-sm">{error}</p>}

        <div className="flex gap-2">
          <button
            onClick={handleConfirm}
            disabled={submitting}
            className="bg-black text-white rounded px-3 py-2 disabled:opacity-50"
          >
            Confirm order
          </button>
          <button onClick={onDone} className="border rounded px-3 py-2">
            Cancel
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="p-6 max-w-lg">
      <h2 className="text-lg font-semibold mb-4">Build order</h2>

      <label className="flex flex-col gap-1 mb-4">
        Buyer
        <select value={buyerId} onChange={(e) => setBuyerId(e.target.value)} className="border rounded px-3 py-2">
          <option value="">Select a buyer…</option>
          {buyers.map((buyer) => (
            <option key={buyer.buyerId} value={buyer.buyerId}>
              {buyer.name} ({buyer.tier})
            </option>
          ))}
        </select>
      </label>

      <p className="font-medium mb-2">In-stock items</p>
      {items.length === 0 ? (
        <p className="text-gray-500">No in-stock items.</p>
      ) : (
        <table className="w-full text-left border-collapse mb-4">
          <thead>
            <tr className="border-b">
              <th className="py-2 pr-4"></th>
              <th className="py-2 pr-4">SKU</th>
              <th className="py-2 pr-4">Grade</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id} className="border-b">
                <td className="py-2 pr-4">
                  <input
                    type="checkbox"
                    checked={selectedItemIds.includes(item.id)}
                    onChange={() => toggleItem(item.id)}
                  />
                </td>
                <td className="py-2 pr-4 font-mono text-sm">{item.skuCode}</td>
                <td className="py-2 pr-4">{item.grade}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {error && <p className="text-red-600 text-sm">{error}</p>}

      <div className="flex gap-2">
        <button
          onClick={handleCreateQuote}
          disabled={submitting || !buyerId || selectedItemIds.length === 0}
          className="bg-black text-white rounded px-3 py-2 disabled:opacity-50"
        >
          Create quote
        </button>
        <button onClick={onDone} className="border rounded px-3 py-2">
          Cancel
        </button>
      </div>
    </div>
  )
}
