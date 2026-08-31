import { useEffect, useState } from 'react'
import { collection, getDocs } from 'firebase/firestore'
import { db } from '../firebase'
import type { BulkStock, Cents } from '../types'

function formatCents(cents: Cents) {
  return `$${(cents / 100).toFixed(2)}`
}

export default function BulkStockList() {
  const [stock, setStock] = useState<BulkStock[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshKey, setRefreshKey] = useState(0)

  useEffect(() => {
    let cancelled = false

    async function load() {
      setLoading(true)
      const snap = await getDocs(collection(db, 'bulkStock'))
      if (!cancelled) {
        setStock(snap.docs.map((d) => d.data() as BulkStock).sort((a, b) => a.skuCode.localeCompare(b.skuCode)))
        setLoading(false)
      }
    }

    load()
    return () => {
      cancelled = true
    }
  }, [refreshKey])

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold">Bulk stock</h2>
        <button onClick={() => setRefreshKey((k) => k + 1)} className="border rounded px-3 py-1">
          Refresh
        </button>
      </div>

      {loading ? (
        <p>Loading…</p>
      ) : stock.length === 0 ? (
        <p className="text-gray-500">No bulk stock received yet.</p>
      ) : (
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="border-b">
              <th className="py-2 pr-4">SKU</th>
              <th className="py-2 pr-4">Qty on hand</th>
              <th className="py-2 pr-4">Avg landed cost</th>
              <th className="py-2 pr-4">Reorder point</th>
              <th className="py-2 pr-4"></th>
            </tr>
          </thead>
          <tbody>
            {stock.map((s) => {
              const low = s.qtyOnHand <= s.reorderPoint
              return (
                <tr key={s.skuCode} className="border-b">
                  <td className="py-2 pr-4 font-mono text-sm">{s.skuCode}</td>
                  <td className="py-2 pr-4">{s.qtyOnHand}</td>
                  <td className="py-2 pr-4">{formatCents(s.avgLandedCost)}</td>
                  <td className="py-2 pr-4">{s.reorderPoint}</td>
                  <td className="py-2 pr-4">
                    {low && <span className="text-red-600 text-sm font-medium">Reorder</span>}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
    </div>
  )
}
