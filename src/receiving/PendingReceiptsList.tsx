import { useEffect, useState } from 'react'
import { collection, getDocs, query, where } from 'firebase/firestore'
import { db } from '../firebase'
import type { BulkReceipt } from '../types'

export default function PendingReceiptsList({ onSelect }: { onSelect: (receipt: BulkReceipt) => void }) {
  const [receipts, setReceipts] = useState<BulkReceipt[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshKey, setRefreshKey] = useState(0)

  useEffect(() => {
    let cancelled = false

    async function load() {
      setLoading(true)
      const snap = await getDocs(query(collection(db, 'bulkReceipts'), where('shippingStatus', '==', 'pending')))
      if (!cancelled) {
        setReceipts(snap.docs.map((d) => d.data() as BulkReceipt))
        setLoading(false)
      }
    }

    load()
    return () => {
      cancelled = true
    }
  }, [refreshKey])

  return (
    <div className="mx-auto max-w-2xl p-4 sm:p-6">
      <div className="page-header">
        <h2 className="page-title">Shipping pending</h2>
        <button onClick={() => setRefreshKey((k) => k + 1)} className="btn-secondary btn-sm">
          Refresh
        </button>
      </div>

      {loading ? (
        <div className="loading-state">
          <span className="spinner" />
          Loading…
        </div>
      ) : receipts.length === 0 ? (
        <p className="text-muted">No receipts waiting on a shipping bill.</p>
      ) : (
        <div className="table-wrap">
          <table className="table-base">
            <thead>
              <tr>
                <th>Supplier</th>
                <th>Invoice</th>
                <th>Lines</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {receipts.map((receipt) => (
                <tr key={receipt.receiptId}>
                  <td>{receipt.supplier}</td>
                  <td>{receipt.invoiceRef}</td>
                  <td>{receipt.lines.length}</td>
                  <td>
                    <button onClick={() => onSelect(receipt)} className="btn-secondary btn-sm">
                      Apply shipping
                    </button>
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
