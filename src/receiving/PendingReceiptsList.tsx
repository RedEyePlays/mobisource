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
    <div className="p-6 max-w-2xl">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold">Shipping pending</h2>
        <button onClick={() => setRefreshKey((k) => k + 1)} className="border rounded px-3 py-1">
          Refresh
        </button>
      </div>

      {loading ? (
        <p>Loading…</p>
      ) : receipts.length === 0 ? (
        <p className="text-gray-500">No receipts waiting on a shipping bill.</p>
      ) : (
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="border-b">
              <th className="py-2 pr-4">Supplier</th>
              <th className="py-2 pr-4">Invoice</th>
              <th className="py-2 pr-4">Lines</th>
              <th className="py-2 pr-4"></th>
            </tr>
          </thead>
          <tbody>
            {receipts.map((receipt) => (
              <tr key={receipt.receiptId} className="border-b">
                <td className="py-2 pr-4">{receipt.supplier}</td>
                <td className="py-2 pr-4">{receipt.invoiceRef}</td>
                <td className="py-2 pr-4">{receipt.lines.length}</td>
                <td className="py-2 pr-4">
                  <button onClick={() => onSelect(receipt)} className="border rounded px-2 py-1 text-sm">
                    Apply shipping
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
