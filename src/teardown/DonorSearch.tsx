import { useEffect, useMemo, useState } from 'react'
import { collection, getDocs, query, where } from 'firebase/firestore'
import { db } from '../firebase'
import type { Cents, Donor } from '../types'

function formatCents(cents: Cents) {
  return `$${(cents / 100).toFixed(2)}`
}

export default function DonorSearch({ onSelect }: { onSelect: (donor: Donor) => void }) {
  const [donors, setDonors] = useState<Donor[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')

  useEffect(() => {
    let cancelled = false

    async function load() {
      setLoading(true)
      const snap = await getDocs(query(collection(db, 'donors'), where('status', '==', 'intact')))
      if (!cancelled) {
        setDonors(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Donor))
        setLoading(false)
      }
    }

    load()
    return () => {
      cancelled = true
    }
  }, [])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return donors
    return donors.filter((d) => d.model.toLowerCase().includes(q) || d.imei.toLowerCase().includes(q))
  }, [donors, search])

  return (
    <div className="p-4 max-w-lg mx-auto">
      <h2 className="text-xl font-semibold mb-4">Tear down a donor</h2>

      <input
        type="text"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search by IMEI or model"
        autoFocus
        className="w-full border rounded-lg px-4 py-4 text-lg mb-4"
      />

      {loading ? (
        <p className="text-lg">Loading…</p>
      ) : filtered.length === 0 ? (
        <p className="text-lg text-gray-500">
          {donors.length === 0 ? 'No intact donors to tear down.' : 'No donors match that search.'}
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          {filtered.map((donor) => (
            <button
              key={donor.id}
              onClick={() => onSelect(donor)}
              className="w-full text-left border rounded-lg px-4 py-4 active:bg-gray-100"
            >
              <div className="flex items-center justify-between">
                <span className="text-lg font-semibold">{donor.model}</span>
                <span className="text-lg">{formatCents(donor.purchaseCost)}</span>
              </div>
              <div className="text-gray-600 mt-1">
                {donor.imei || `IMEI blank — ${donor.imeiBlankReason}`}
              </div>
              <div className="text-gray-600">Condition {donor.condition}</div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
