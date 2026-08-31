import { useEffect, useState } from 'react'
import { collection, getDocs, query, where } from 'firebase/firestore'
import { db } from '../firebase.js'

function formatCents(cents) {
  return `$${(cents / 100).toFixed(2)}`
}

export default function DonorList({ onIntake }) {
  const [donors, setDonors] = useState([])
  const [loading, setLoading] = useState(true)
  const [refreshKey, setRefreshKey] = useState(0)

  useEffect(() => {
    let cancelled = false

    async function load() {
      setLoading(true)
      const snap = await getDocs(query(collection(db, 'donors'), where('status', '==', 'intact')))
      if (!cancelled) {
        setDonors(snap.docs.map((d) => ({ id: d.id, ...d.data() })))
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
        <h2 className="text-lg font-semibold">Intact donors</h2>
        <div className="flex gap-2">
          <button onClick={() => setRefreshKey((k) => k + 1)} className="border rounded px-3 py-1">
            Refresh
          </button>
          <button onClick={onIntake} className="bg-black text-white rounded px-3 py-1">
            Intake donor
          </button>
        </div>
      </div>

      {loading ? (
        <p>Loading…</p>
      ) : donors.length === 0 ? (
        <p className="text-gray-500">No intact donors.</p>
      ) : (
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="border-b">
              <th className="py-2 pr-4">Model</th>
              <th className="py-2 pr-4">IMEI</th>
              <th className="py-2 pr-4">Condition</th>
              <th className="py-2 pr-4">Source</th>
              <th className="py-2 pr-4">Purchase cost</th>
            </tr>
          </thead>
          <tbody>
            {donors.map((donor) => (
              <tr key={donor.id} className="border-b">
                <td className="py-2 pr-4">{donor.model}</td>
                <td className="py-2 pr-4">{donor.imei || `(blank — ${donor.imeiBlankReason})`}</td>
                <td className="py-2 pr-4">{donor.condition}</td>
                <td className="py-2 pr-4">{donor.source}</td>
                <td className="py-2 pr-4">{formatCents(donor.purchaseCost)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
