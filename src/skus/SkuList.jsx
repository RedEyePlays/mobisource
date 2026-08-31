import { useEffect, useState } from 'react'
import { collection, getDocs, orderBy, query } from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { db, functions } from '../firebase.js'

function formatCents(cents) {
  return `$${(cents / 100).toFixed(2)}`
}

export default function SkuList({ onCreate, onEdit }) {
  const [skus, setSkus] = useState([])
  const [loading, setLoading] = useState(true)
  const [refreshKey, setRefreshKey] = useState(0)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false

    async function load() {
      setLoading(true)
      const snap = await getDocs(query(collection(db, 'skus'), orderBy('skuCode')))
      if (!cancelled) {
        setSkus(snap.docs.map((d) => d.data()))
        setLoading(false)
      }
    }

    load()
    return () => {
      cancelled = true
    }
  }, [refreshKey])

  async function handleDeactivate(skuCode) {
    setError('')
    try {
      const deactivateSku = httpsCallable(functions, 'deactivateSku')
      await deactivateSku({ skuCode })
      setRefreshKey((k) => k + 1)
    } catch (err) {
      setError(err.message)
    }
  }

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold">SKU catalog</h2>
        <div className="flex gap-2">
          <button onClick={() => setRefreshKey((k) => k + 1)} className="border rounded px-3 py-1">
            Refresh
          </button>
          <button onClick={onCreate} className="bg-black text-white rounded px-3 py-1">
            New SKU
          </button>
        </div>
      </div>

      {error && <p className="text-red-600 text-sm mb-2">{error}</p>}

      {loading ? (
        <p>Loading…</p>
      ) : skus.length === 0 ? (
        <p className="text-gray-500">No SKUs yet.</p>
      ) : (
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="border-b">
              <th className="py-2 pr-4">SKU</th>
              <th className="py-2 pr-4">Tracking</th>
              <th className="py-2 pr-4">Expected resale</th>
              <th className="py-2 pr-4">Retail</th>
              <th className="py-2 pr-4">Active</th>
              <th className="py-2 pr-4"></th>
            </tr>
          </thead>
          <tbody>
            {skus.map((sku) => (
              <tr key={sku.skuCode} className="border-b">
                <td className="py-2 pr-4 font-mono text-sm">{sku.skuCode}</td>
                <td className="py-2 pr-4">{sku.trackingMode}</td>
                <td className="py-2 pr-4">{formatCents(sku.expectedResale)}</td>
                <td className="py-2 pr-4">{formatCents(sku.listPriceRetail)}</td>
                <td className="py-2 pr-4">{sku.active ? 'yes' : 'no'}</td>
                <td className="py-2 pr-4 flex gap-2">
                  <button onClick={() => onEdit(sku)} className="border rounded px-2 py-1 text-sm">
                    Edit
                  </button>
                  {sku.active && (
                    <button
                      onClick={() => handleDeactivate(sku.skuCode)}
                      className="border rounded px-2 py-1 text-sm"
                    >
                      Deactivate
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
