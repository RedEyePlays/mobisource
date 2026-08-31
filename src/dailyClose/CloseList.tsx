import { useEffect, useState } from 'react'
import { collection, getDocs, orderBy, query } from 'firebase/firestore'
import { db } from '../firebase'
import type { Cents, DailyClose } from '../types'

function formatCents(cents: Cents) {
  return `$${(cents / 100).toFixed(2)}`
}

export default function CloseList() {
  const [closes, setCloses] = useState<DailyClose[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshKey, setRefreshKey] = useState(0)

  useEffect(() => {
    let cancelled = false

    async function load() {
      setLoading(true)
      const snap = await getDocs(query(collection(db, 'dailyCloses'), orderBy('date', 'desc')))
      if (!cancelled) {
        setCloses(snap.docs.map((d) => d.data() as DailyClose))
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
      <div className="mb-4 flex items-center justify-between">
        <h2 className="page-title">Close history</h2>
        <button onClick={() => setRefreshKey((k) => k + 1)} className="btn-secondary btn-sm">
          Refresh
        </button>
      </div>

      {loading ? (
        <p className="text-muted">Loading…</p>
      ) : closes.length === 0 ? (
        <p className="text-muted">No days closed yet.</p>
      ) : (
        <div className="table-wrap">
          <table className="table-base">
            <thead>
              <tr>
                <th>Date</th>
                <th>Cash sales</th>
                <th>Card sales</th>
                <th>e-Transfer sales</th>
                <th>Counted cash</th>
                <th>Variance</th>
              </tr>
            </thead>
            <tbody>
              {closes.map((close) => (
                <tr key={close.date}>
                  <td>{close.date}</td>
                  <td>{formatCents(close.cashSalesTotal)}</td>
                  <td>{formatCents(close.cardSalesTotal)}</td>
                  <td>{formatCents(close.eTransferSalesTotal)}</td>
                  <td>{formatCents(close.countedCash)}</td>
                  <td>
                    <span className={close.cashVariance !== 0 ? 'num-md text-danger' : 'num-md'}>
                      {close.cashVariance > 0 ? '+' : ''}
                      {formatCents(close.cashVariance)}
                    </span>
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
