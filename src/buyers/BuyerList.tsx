import { useEffect, useState } from 'react'
import { collection, getDocs, orderBy, query } from 'firebase/firestore'
import { db } from '../firebase'
import type { Buyer } from '../types'

export default function BuyerList({ onCreate, onEdit }: { onCreate: () => void; onEdit: (buyer: Buyer) => void }) {
  const [buyers, setBuyers] = useState<Buyer[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshKey, setRefreshKey] = useState(0)

  useEffect(() => {
    let cancelled = false

    async function load() {
      setLoading(true)
      const snap = await getDocs(query(collection(db, 'buyers'), orderBy('name')))
      if (!cancelled) {
        setBuyers(snap.docs.map((d) => d.data() as Buyer))
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
        <h2 className="page-title">Buyers</h2>
        <div className="flex flex-wrap gap-2">
          <button onClick={() => setRefreshKey((k) => k + 1)} className="btn-secondary btn-sm">
            Refresh
          </button>
          <button onClick={onCreate} className="btn-primary btn-sm">
            New buyer
          </button>
        </div>
      </div>

      {loading ? (
        <p>Loading…</p>
      ) : buyers.length === 0 ? (
        <p className="text-muted">No buyers yet.</p>
      ) : (
        <div className="table-wrap">
          <table className="table-base">
            <thead>
              <tr>
                <th>Name</th>
                <th>Type</th>
                <th>Tier</th>
                <th>Terms</th>
                <th>Tax</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {buyers.map((buyer) => (
                <tr key={buyer.buyerId}>
                  <td>{buyer.name}</td>
                  <td>{buyer.type}</td>
                  <td>{buyer.tier}</td>
                  <td>{buyer.terms}</td>
                  <td>{buyer.taxStatus ?? 'taxable'}</td>
                  <td>
                    <button onClick={() => onEdit(buyer)} className="btn-secondary btn-sm">
                      Edit
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
