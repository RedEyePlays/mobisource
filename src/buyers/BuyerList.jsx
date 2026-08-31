import { useEffect, useState } from 'react'
import { collection, getDocs, orderBy, query } from 'firebase/firestore'
import { db } from '../firebase.js'

export default function BuyerList({ onCreate, onEdit }) {
  const [buyers, setBuyers] = useState([])
  const [loading, setLoading] = useState(true)
  const [refreshKey, setRefreshKey] = useState(0)

  useEffect(() => {
    let cancelled = false

    async function load() {
      setLoading(true)
      const snap = await getDocs(query(collection(db, 'buyers'), orderBy('name')))
      if (!cancelled) {
        setBuyers(snap.docs.map((d) => d.data()))
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
        <h2 className="text-lg font-semibold">Buyers</h2>
        <div className="flex gap-2">
          <button onClick={() => setRefreshKey((k) => k + 1)} className="border rounded px-3 py-1">
            Refresh
          </button>
          <button onClick={onCreate} className="bg-black text-white rounded px-3 py-1">
            New buyer
          </button>
        </div>
      </div>

      {loading ? (
        <p>Loading…</p>
      ) : buyers.length === 0 ? (
        <p className="text-gray-500">No buyers yet.</p>
      ) : (
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="border-b">
              <th className="py-2 pr-4">Name</th>
              <th className="py-2 pr-4">Type</th>
              <th className="py-2 pr-4">Tier</th>
              <th className="py-2 pr-4">Terms</th>
              <th className="py-2 pr-4"></th>
            </tr>
          </thead>
          <tbody>
            {buyers.map((buyer) => (
              <tr key={buyer.buyerId} className="border-b">
                <td className="py-2 pr-4">{buyer.name}</td>
                <td className="py-2 pr-4">{buyer.type}</td>
                <td className="py-2 pr-4">{buyer.tier}</td>
                <td className="py-2 pr-4">{buyer.terms}</td>
                <td className="py-2 pr-4">
                  <button onClick={() => onEdit(buyer)} className="border rounded px-2 py-1 text-sm">
                    Edit
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
