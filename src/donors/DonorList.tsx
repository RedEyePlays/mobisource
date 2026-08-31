import { Fragment, useEffect, useState } from 'react'
import { collection, doc, getDoc, getDocs } from 'firebase/firestore'
import { db } from '../firebase'
import type { Cents, Donor, Teardown } from '../types'

function formatCents(cents: Cents) {
  return `$${(cents / 100).toFixed(2)}`
}

function TeardownParts({ teardownId }: { teardownId: string }) {
  const [teardown, setTeardown] = useState<Teardown | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    async function load() {
      const snap = await getDoc(doc(db, 'teardowns', teardownId))
      if (!cancelled) {
        setTeardown(snap.exists() ? (snap.data() as Teardown) : null)
        setLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [teardownId])

  if (loading) return <p className="text-muted pl-4 text-sm">Loading parts…</p>
  if (!teardown) return <p className="text-muted pl-4 text-sm">Teardown record not found.</p>

  return (
    <div className="pb-3 pl-4 text-sm">
      <div className="table-wrap">
        <table className="table-base">
          <thead>
            <tr>
              <th>SKU</th>
              <th>Outcome</th>
              <th>Allocated cost</th>
            </tr>
          </thead>
          <tbody>
            {teardown.allocations.map((a) => (
              <tr key={a.skuCode}>
                <td className="font-mono">{a.skuCode}</td>
                <td>sellable</td>
                <td className="num-md">{formatCents(a.allocatedCost)}</td>
              </tr>
            ))}
            {teardown.scrapped.map((s, i) => (
              <tr key={`scrapped-${i}`}>
                <td>{s.partType}</td>
                <td>scrapped ({s.reason})</td>
                <td className="num-md">$0.00</td>
              </tr>
            ))}
            {teardown.notHarvested.map((n, i) => (
              <tr key={`not-harvested-${i}`}>
                <td className="text-muted">{n.partType}</td>
                <td className="text-muted">not harvested</td>
                <td className="text-muted">—</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export default function DonorList({ onIntake }: { onIntake: () => void }) {
  const [donors, setDonors] = useState<Donor[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshKey, setRefreshKey] = useState(0)
  const [expandedId, setExpandedId] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    async function load() {
      setLoading(true)
      const snap = await getDocs(collection(db, 'donors'))
      if (!cancelled) {
        setDonors(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Donor))
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
        <h2 className="page-title">Donors</h2>
        <div className="flex flex-wrap gap-2">
          <button onClick={() => setRefreshKey((k) => k + 1)} className="btn-secondary btn-sm">
            Refresh
          </button>
          <button onClick={onIntake} className="btn-primary btn-sm">
            Intake donor
          </button>
        </div>
      </div>

      {loading ? (
        <p>Loading…</p>
      ) : donors.length === 0 ? (
        <p className="text-muted">No donors yet.</p>
      ) : (
        <div className="table-wrap">
          <table className="table-base">
            <thead>
              <tr>
                <th>Model</th>
                <th>IMEI</th>
                <th>Condition</th>
                <th>Status</th>
                <th>Purchase cost</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {donors.map((donor) => (
                <Fragment key={donor.id}>
                  <tr>
                    <td>{donor.model}</td>
                    <td>{donor.imei || `(blank — ${donor.imeiBlankReason})`}</td>
                    <td>{donor.condition}</td>
                    <td>{donor.status}</td>
                    <td className="num-md">{formatCents(donor.purchaseCost)}</td>
                    <td>
                      {donor.status === 'tornDown' && (
                        <button
                          onClick={() => setExpandedId(expandedId === donor.id ? null : donor.id)}
                          className="btn-secondary btn-sm"
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
        </div>
      )}
    </div>
  )
}
