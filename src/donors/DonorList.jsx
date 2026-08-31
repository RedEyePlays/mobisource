import { Fragment, useEffect, useState } from 'react'
import { collection, doc, getDoc, getDocs } from 'firebase/firestore'
import { db } from '../firebase.js'

function formatCents(cents) {
  return `$${(cents / 100).toFixed(2)}`
}

function TeardownParts({ teardownId }) {
  const [teardown, setTeardown] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    async function load() {
      const snap = await getDoc(doc(db, 'teardowns', teardownId))
      if (!cancelled) {
        setTeardown(snap.exists() ? snap.data() : null)
        setLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [teardownId])

  if (loading) return <p className="text-sm text-gray-500 pl-4">Loading parts…</p>
  if (!teardown) return <p className="text-sm text-gray-500 pl-4">Teardown record not found.</p>

  return (
    <div className="pl-4 pb-3 text-sm">
      <table className="w-full text-left border-collapse">
        <thead>
          <tr className="border-b">
            <th className="py-1 pr-4">SKU</th>
            <th className="py-1 pr-4">Outcome</th>
            <th className="py-1 pr-4">Allocated cost</th>
          </tr>
        </thead>
        <tbody>
          {teardown.allocations.map((a) => (
            <tr key={a.skuCode} className="border-b">
              <td className="py-1 pr-4 font-mono">{a.skuCode}</td>
              <td className="py-1 pr-4">sellable</td>
              <td className="py-1 pr-4">{formatCents(a.allocatedCost)}</td>
            </tr>
          ))}
          {teardown.scrapped.map((s, i) => (
            <tr key={`scrapped-${i}`} className="border-b">
              <td className="py-1 pr-4">{s.partType}</td>
              <td className="py-1 pr-4">scrapped ({s.reason})</td>
              <td className="py-1 pr-4">$0.00</td>
            </tr>
          ))}
          {teardown.notHarvested.map((n, i) => (
            <tr key={`not-harvested-${i}`} className="border-b text-gray-500">
              <td className="py-1 pr-4">{n.partType}</td>
              <td className="py-1 pr-4">not harvested</td>
              <td className="py-1 pr-4">—</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default function DonorList({ onIntake }) {
  const [donors, setDonors] = useState([])
  const [loading, setLoading] = useState(true)
  const [refreshKey, setRefreshKey] = useState(0)
  const [expandedId, setExpandedId] = useState(null)

  useEffect(() => {
    let cancelled = false

    async function load() {
      setLoading(true)
      const snap = await getDocs(collection(db, 'donors'))
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
        <h2 className="text-lg font-semibold">Donors</h2>
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
        <p className="text-gray-500">No donors yet.</p>
      ) : (
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="border-b">
              <th className="py-2 pr-4">Model</th>
              <th className="py-2 pr-4">IMEI</th>
              <th className="py-2 pr-4">Condition</th>
              <th className="py-2 pr-4">Status</th>
              <th className="py-2 pr-4">Purchase cost</th>
              <th className="py-2 pr-4"></th>
            </tr>
          </thead>
          <tbody>
            {donors.map((donor) => (
              <Fragment key={donor.id}>
                <tr className="border-b">
                  <td className="py-2 pr-4">{donor.model}</td>
                  <td className="py-2 pr-4">{donor.imei || `(blank — ${donor.imeiBlankReason})`}</td>
                  <td className="py-2 pr-4">{donor.condition}</td>
                  <td className="py-2 pr-4">{donor.status}</td>
                  <td className="py-2 pr-4">{formatCents(donor.purchaseCost)}</td>
                  <td className="py-2 pr-4">
                    {donor.status === 'tornDown' && (
                      <button
                        onClick={() => setExpandedId(expandedId === donor.id ? null : donor.id)}
                        className="border rounded px-2 py-1 text-sm"
                      >
                        {expandedId === donor.id ? 'Hide parts' : 'View parts'}
                      </button>
                    )}
                  </td>
                </tr>
                {expandedId === donor.id && (
                  <tr>
                    <td colSpan={6}>
                      <TeardownParts teardownId={donor.teardownId} />
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
