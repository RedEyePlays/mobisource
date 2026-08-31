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
    <div className="p-4 sm:p-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h2 className="page-title">Bulk stock</h2>
        <button onClick={() => setRefreshKey((k) => k + 1)} className="btn-secondary btn-sm">
          Refresh
        </button>
      </div>

      {loading ? (
        <p className="text-muted">Loading…</p>
      ) : stock.length === 0 ? (
        <p className="text-muted">No bulk stock received yet.</p>
      ) : (
        <div className="table-wrap">
          <table className="table-base">
            <thead>
              <tr>
                <th>SKU</th>
                <th>Qty on hand</th>
                <th>Avg landed cost</th>
                <th>Reorder point</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {stock.map((s) => {
                const low = s.qtyOnHand <= s.reorderPoint
                return (
                  <tr key={s.skuCode}>
                    <td className="font-mono text-sm">{s.skuCode}</td>
                    <td>{s.qtyOnHand}</td>
                    <td className="num-md">{formatCents(s.avgLandedCost)}</td>
                    <td>{s.reorderPoint}</td>
                    <td>
                      {low && <span className="text-danger text-sm font-medium">Reorder</span>}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
