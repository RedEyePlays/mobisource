import { useEffect, useState } from 'react'
import { collection, getDocs, orderBy, query } from 'firebase/firestore'
import { db } from '../firebase.js'

function formatCents(cents) {
  return `$${(cents / 100).toFixed(2)}`
}

function margin(order) {
  return order.lines.reduce((sum, line) => sum + (line.unitPrice - line.unitCost), 0)
}

export default function OrderList({ onCreate }) {
  const [orders, setOrders] = useState([])
  const [loading, setLoading] = useState(true)
  const [refreshKey, setRefreshKey] = useState(0)

  useEffect(() => {
    let cancelled = false

    async function load() {
      setLoading(true)
      const snap = await getDocs(query(collection(db, 'salesOrders'), orderBy('createdAt', 'desc')))
      if (!cancelled) {
        setOrders(snap.docs.map((d) => d.data()))
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
        <h2 className="text-lg font-semibold">Sales orders</h2>
        <div className="flex gap-2">
          <button onClick={() => setRefreshKey((k) => k + 1)} className="border rounded px-3 py-1">
            Refresh
          </button>
          <button onClick={onCreate} className="bg-black text-white rounded px-3 py-1">
            New order
          </button>
        </div>
      </div>

      {loading ? (
        <p>Loading…</p>
      ) : orders.length === 0 ? (
        <p className="text-gray-500">No orders yet.</p>
      ) : (
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="border-b">
              <th className="py-2 pr-4">Order</th>
              <th className="py-2 pr-4">Buyer</th>
              <th className="py-2 pr-4">Status</th>
              <th className="py-2 pr-4">Total</th>
              <th className="py-2 pr-4">Margin</th>
            </tr>
          </thead>
          <tbody>
            {orders.map((order) => (
              <tr key={order.orderId} className="border-b">
                <td className="py-2 pr-4 font-mono text-sm">{order.orderId}</td>
                <td className="py-2 pr-4">{order.buyerId}</td>
                <td className="py-2 pr-4">{order.status}</td>
                <td className="py-2 pr-4">{formatCents(order.total)}</td>
                <td className="py-2 pr-4">{formatCents(margin(order))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
