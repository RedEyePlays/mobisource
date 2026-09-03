import { useEffect, useState } from 'react'
import { collection, getDocs, orderBy, query } from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { db, functions } from '../firebase'
import { downloadInvoicePdf } from './downloadInvoice'
import type { Cents, SalesOrder } from '../types'

function formatCents(cents: Cents) {
  return `$${(cents / 100).toFixed(2)}`
}

function margin(order: SalesOrder): Cents {
  return order.lines.reduce((sum, line) => sum + (line.unitPrice - line.unitCost) * line.qty, 0) as Cents
}

const DAY_MS = 1000 * 60 * 60 * 24

// Informational only — the 7-day auto-expiry sweep re-derives age itself,
// server-side, at run time (docs/SCHEMA.md §14).
function quoteAgeDays(order: SalesOrder): number {
  return Math.floor((Date.now() - order.createdAt.toDate().getTime()) / DAY_MS)
}

export default function OrderList({ onCreate, onReturn }: { onCreate: () => void; onReturn: (order: SalesOrder) => void }) {
  const [orders, setOrders] = useState<SalesOrder[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshKey, setRefreshKey] = useState(0)
  const [downloadingId, setDownloadingId] = useState<string | null>(null)
  const [actionError, setActionError] = useState('')
  const [cancellingId, setCancellingId] = useState<string | null>(null)

  async function handleDownloadInvoice(orderId: string) {
    setActionError('')
    setDownloadingId(orderId)
    try {
      await downloadInvoicePdf(orderId)
    } catch (err) {
      setActionError((err as Error).message)
    } finally {
      setDownloadingId(null)
    }
  }

  async function handleCancelQuote(orderId: string) {
    setActionError('')
    setCancellingId(orderId)
    try {
      const cancelOrder = httpsCallable<{ orderId: string }, { orderId: string; status: string }>(
        functions,
        'cancelOrder',
      )
      await cancelOrder({ orderId })
      setRefreshKey((k) => k + 1)
    } catch (err) {
      setActionError((err as Error).message)
    } finally {
      setCancellingId(null)
    }
  }

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

      {actionError && <p className="banner-danger mb-3">{actionError}</p>}

      {loading ? (
        <div className="loading-state">
          <span className="spinner" />
          Loading…
        </div>
      ) : orders.length === 0 ? (
        <p className="empty-state">No orders yet.</p>
      ) : (
        <div className="table-wrap">
          <table className="table-base">
            <thead>
              <tr>
                <th>Order</th>
                <th>Buyer</th>
                <th>Status</th>
                <th>Age</th>
                <th>Payment</th>
                <th>Tax</th>
                <th>Total</th>
                <th>Margin</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {orders.map((order) => (
                <tr key={order.orderId}>
                  <td className="font-mono text-sm">{order.orderId}</td>
                  <td>{order.buyerId}</td>
                  <td>{order.status}</td>
                  <td>
                    {order.status === 'quoted' ? (
                      <span className={quoteAgeDays(order) >= 7 ? 'text-danger' : undefined}>
                        {quoteAgeDays(order)}d
                      </span>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td>{order.paymentMethod ?? '—'}</td>
                  <td>
                    <span className="num-md">{formatCents(order.tax)}</span>
                  </td>
                  <td>
                    <span className="num-md">{formatCents(order.total)}</span>
                  </td>
                  <td>
                    <span className="num-md">{formatCents(margin(order))}</span>
                  </td>
                  <td>
                    {order.status === 'quoted' && (
                      <button
                        type="button"
                        disabled={cancellingId === order.orderId}
                        onClick={() => void handleCancelQuote(order.orderId)}
                        className="btn-secondary btn-sm"
                      >
                        {cancellingId === order.orderId ? '…' : 'Cancel quote'}
                      </button>
                    )}
                    {order.status !== 'quoted' && order.status !== 'cancelled' && (
                      <div className="flex gap-2">
                        <button
                          type="button"
                          disabled={downloadingId === order.orderId}
                          onClick={() => void handleDownloadInvoice(order.orderId)}
                          className="btn-secondary btn-sm"
                        >
                          {downloadingId === order.orderId ? '…' : 'Download invoice'}
                        </button>
                        <button type="button" onClick={() => onReturn(order)} className="btn-secondary btn-sm">
                          Process return
                        </button>
                      </div>
                    )}
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
