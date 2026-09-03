import { useEffect, useState } from 'react'
import { collection, getDocs, orderBy, query } from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { db, functions } from '../firebase'
import { printBulkLabels } from '../printing/printClient'
import type { Cents, Sku } from '../types'

function formatCents(cents: Cents) {
  return `$${(cents / 100).toFixed(2)}`
}

export default function SkuList({ onCreate, onEdit }: { onCreate: () => void; onEdit: (sku: Sku) => void }) {
  const [skus, setSkus] = useState<Sku[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshKey, setRefreshKey] = useState(0)
  const [error, setError] = useState('')

  const [printCopies, setPrintCopies] = useState<Record<string, string>>({})
  const [printingCode, setPrintingCode] = useState<string | null>(null)
  const [printStatus, setPrintStatus] = useState<Record<string, 'ok' | 'error' | undefined>>({})

  useEffect(() => {
    let cancelled = false

    async function load() {
      setLoading(true)
      const snap = await getDocs(query(collection(db, 'skus'), orderBy('skuCode')))
      if (!cancelled) {
        setSkus(snap.docs.map((d) => d.data() as Sku))
        setLoading(false)
      }
    }

    load()
    return () => {
      cancelled = true
    }
  }, [refreshKey])

  async function handleDeactivate(skuCode: string) {
    setError('')
    try {
      const deactivateSku = httpsCallable(functions, 'deactivateSku')
      await deactivateSku({ skuCode })
      setRefreshKey((k) => k + 1)
    } catch (err) {
      setError((err as Error).message)
    }
  }

  async function handlePrint(sku: Sku) {
    const copies = Math.max(1, Math.round(Number(printCopies[sku.skuCode] || '1')))
    setPrintingCode(sku.skuCode)
    setPrintStatus((s) => ({ ...s, [sku.skuCode]: undefined }))
    try {
      await printBulkLabels(
        { skuCode: sku.skuCode, model: sku.model, grade: sku.grade, partType: sku.partType },
        copies,
      )
      setPrintStatus((s) => ({ ...s, [sku.skuCode]: 'ok' }))
    } catch {
      setPrintStatus((s) => ({ ...s, [sku.skuCode]: 'error' }))
    } finally {
      setPrintingCode(null)
    }
  }

  return (
    <div className="p-4 sm:p-6">
      <div className="page-header">
        <h2 className="page-title">SKU catalog</h2>
        <div className="flex flex-wrap gap-2">
          <button onClick={() => setRefreshKey((k) => k + 1)} className="btn-secondary btn-sm">
            Refresh
          </button>
          <button onClick={onCreate} className="btn-primary btn-sm">
            New SKU
          </button>
        </div>
      </div>

      {error && <p className="banner-danger mb-2">{error}</p>}

      {loading ? (
        <div className="loading-state">
          <span className="spinner" />
          Loading…
        </div>
      ) : skus.length === 0 ? (
        <p className="empty-state">No SKUs yet.</p>
      ) : (
        <div className="table-wrap">
          <table className="table-base">
            <thead>
              <tr>
                <th>SKU</th>
                <th>Tracking</th>
                <th>Expected resale</th>
                <th>Retail</th>
                <th>Active</th>
                <th></th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {skus.map((sku) => (
                <tr key={sku.skuCode}>
                  <td className="font-mono text-sm">{sku.skuCode}</td>
                  <td>{sku.trackingMode}</td>
                  <td className="num-md">{formatCents(sku.expectedResale)}</td>
                  <td className="num-md">{formatCents(sku.listPriceRetail)}</td>
                  <td>{sku.active ? 'yes' : 'no'}</td>
                  <td>
                    <div className="flex gap-2">
                      <button onClick={() => onEdit(sku)} className="btn-secondary btn-sm">
                        Edit
                      </button>
                      {sku.active && (
                        <button onClick={() => handleDeactivate(sku.skuCode)} className="btn-secondary btn-sm">
                          Deactivate
                        </button>
                      )}
                    </div>
                  </td>
                  <td>
                    {sku.trackingMode === 'bulk' && (
                      <div className="flex items-center gap-2">
                        <input
                          type="number"
                          min="1"
                          step="1"
                          value={printCopies[sku.skuCode] ?? '1'}
                          onChange={(e) =>
                            setPrintCopies((c) => ({ ...c, [sku.skuCode]: e.target.value }))
                          }
                          className="input w-16 min-h-9 px-2 py-1 text-sm"
                          aria-label={`Copies for ${sku.skuCode}`}
                        />
                        <button
                          onClick={() => handlePrint(sku)}
                          disabled={printingCode === sku.skuCode}
                          className="btn-secondary btn-sm"
                        >
                          {printingCode === sku.skuCode ? 'Printing…' : 'Print labels'}
                        </button>
                        {printStatus[sku.skuCode] === 'ok' && (
                          <span className="text-xs text-emerald-600 dark:text-emerald-400">Printed</span>
                        )}
                        {printStatus[sku.skuCode] === 'error' && <span className="text-danger text-xs">Failed</span>}
                      </div>
                    )}
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
