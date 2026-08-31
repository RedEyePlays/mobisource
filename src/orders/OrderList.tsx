import { useEffect, useState } from 'react'
import { collection, getDocs, orderBy, query } from 'firebase/firestore'
import { db } from '../firebase'
import type { Cents, SalesOrder } from '../types'

function formatCents(cents: Cents) {
  return `$${(cents / 100).toFixed(2)}`
}

function margin(order: SalesOrder): Cents {
  return order.lines.reduce((sum, line) => sum + (line.unitPrice - line.unitCost), 0) as Cents
}

export default function OrderList({ onCreate }: { onCreate: () => void }) {
  const [orders, setOrders] = useState<SalesOrder[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshKey, setRefreshKey] = useState(0)

  useEffect(() => {
    let cancelled = false

    async function load() {
      setLoading(true)
      const snap = await getDocs(query(collection(db, 'salesOrders'), orderBy('createdAt', 'desc')))
      if (!cancelled) {
        setOrders(snap.docs.map((d) => d.data() as SalesOrder))
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
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="page-title">Sales orders</h2>
        <div className="flex gap-2">
          <button onClick={() => setRefreshKey((k) => k + 1)} className="btn-secondary btn-sm">
            Refresh
          </button>
          <button onClick={onCreate} className="btn-primary btn-sm">
            New order
          </button>
        </div>
      </div>

      {loading ? (
        <p className="text-muted">Loading…</p>
      ) : orders.length === 0 ? (
        <p className="text-muted">No orders yet.</p>
      ) : (
        <div className="table-wrap">
          <table className="table-base">
            <thead>
              <tr>
                <th>Order</th>
                <th>Buyer</th>
                <th>Status</th>
                <th>Total</th>
                <th>Margin</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((order) => (
                <tr key={order.orderId}>
                  <td className="font-mono text-sm">{order.orderId}</td>
                  <td>{order.buyerId}</td>
                  <td>{order.status}</td>
                  <td>
                    <span className="num-md">{formatCents(order.total)}</span>
                  </td>
                  <td>
                    <span className="num-md">{formatCents(margin(order))}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
