import { useState } from 'react'
import { collection, getDocs, query, where } from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { db, functions } from '../firebase'
import type { Sku } from '../types'

interface AdjustStockResult {
  applied: boolean
  delta: number
  movementIds: string[]
}

export default function CountScreen() {
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<Sku[]>([])
  const [sku, setSku] = useState<Sku | null>(null)
  const [systemQty, setSystemQty] = useState<number | null>(null)
  const [physicalQty, setPhysicalQty] = useState('')
  const [reason, setReason] = useState('')
  const [loadingCount, setLoadingCount] = useState(false)
  const [committing, setCommitting] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState<AdjustStockResult | null>(null)

  async function handleSearchChange(q: string) {
    setSearchQuery(q)
    if (!q.trim()) {
      setSearchResults([])
      return
    }
    const snap = await getDocs(collection(db, 'skus'))
    const query = q.trim().toLowerCase()
    setSearchResults(
      snap.docs
        .map((d) => d.data() as Sku)
        .filter((s) => s.active && s.skuCode.toLowerCase().includes(query))
        .slice(0, 20),
    )
  }

  async function pickSku(picked: Sku) {
    setSku(picked)
    setSearchQuery('')
    setSearchResults([])
    setPhysicalQty('')
    setReason('')
    setResult(null)
    setError('')
    setLoadingCount(true)
    try {
      if (picked.trackingMode === 'bulk') {
        const snap = await getDocs(query(collection(db, 'bulkStock'), where('skuCode', '==', picked.skuCode)))
        setSystemQty(snap.empty ? 0 : (snap.docs[0].data().qtyOnHand as number))
      } else {
        const snap = await getDocs(
          query(collection(db, 'stockItems'), where('skuCode', '==', picked.skuCode), where('status', '==', 'inStock')),
        )
        setSystemQty(snap.size)
      }
    } finally {
      setLoadingCount(false)
    }
  }

  function reset() {
    setSku(null)
    setSystemQty(null)
    setPhysicalQty('')
    setReason('')
    setResult(null)
    setError('')
  }

  const physical = physicalQty === '' ? null : Number(physicalQty)
  const variance = physical != null && systemQty != null ? physical - systemQty : null

  async function handleCommit() {
    if (!sku || physical == null || !reason.trim()) return
    setError('')
    setCommitting(true)
    try {
      const adjustStock = httpsCallable<{ skuCode: string; newQty: number; reason: string }, AdjustStockResult>(
        functions,
        'adjustStock',
      )
      const response = await adjustStock({ skuCode: sku.skuCode, newQty: physical, reason })
      setResult(response.data)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setCommitting(false)
    }
  }

  return (
    <div className="mx-auto max-w-lg p-4 sm:p-6">
      <h2 className="page-title mb-4">Cycle count</h2>

      {!sku ? (
        <div className="card p-3">
          <input
            value={searchQuery}
            onChange={(e) => void handleSearchChange(e.target.value)}
            placeholder="Search by SKU code"
            autoFocus
            className="input mb-2"
          />
          <div className="flex max-h-64 flex-col gap-1 overflow-y-auto">
            {searchResults.map((s) => (
              <button
                key={s.skuCode}
                type="button"
                onClick={() => void pickSku(s)}
                className="card active:bg-slate-100 dark:active:bg-slate-800 px-2 py-1.5 text-left"
              >
                <div className="font-mono text-sm">{s.skuCode}</div>
                <div className="text-muted text-xs">
                  {s.partType} · {s.model} · {s.trackingMode}
                </div>
              </button>
            ))}
          </div>
        </div>
      ) : result ? (
        <div className="card mb-4 flex flex-col gap-3 p-4">
          <p className="section-title">Adjustment committed</p>
          <div className="flex items-center justify-between">
            <span className="text-muted text-sm">SKU</span>
            <span className="font-mono text-sm">{sku.skuCode}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-muted text-sm">Variance applied</span>
            <span className="num-md">{result.delta > 0 ? `+${result.delta}` : result.delta}</span>
          </div>
          <button onClick={reset} className="btn-primary btn-block mt-2">
            Count another SKU
          </button>
        </div>
      ) : (
        <div className="card mb-4 flex flex-col gap-4 p-4">
          <div>
            <p className="eyebrow">SKU</p>
            <p className="font-mono text-base">{sku.skuCode}</p>
            <p className="text-muted text-sm">
              {sku.partType} · {sku.model} · {sku.trackingMode}
            </p>
          </div>

          <div className="flex items-center justify-between">
            <span className="text-muted text-sm">System count</span>
            <span className="num-md">{loadingCount ? '…' : systemQty}</span>
          </div>

          <label className="field">
            Physical count
            <input
              type="number"
              min={0}
              value={physicalQty}
              onChange={(e) => setPhysicalQty(e.target.value)}
              className="input"
              disabled={loadingCount}
            />
          </label>

          {variance != null && (
            <div className="flex items-center justify-between">
              <span className="text-muted text-sm">Variance</span>
              <span className={variance !== 0 ? 'num-md text-danger' : 'num-md'}>
                {variance > 0 ? `+${variance}` : variance}
              </span>
            </div>
          )}

          <label className="field">
            Reason
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Not found on shelf, damaged, miscount"
              className="input"
            />
          </label>

          {error && <p className="banner-danger">{error}</p>}

          <div className="flex flex-col gap-2 sm:flex-row">
            <button
              onClick={() => void handleCommit()}
              disabled={committing || physical == null || variance === 0 || !reason.trim()}
              className="btn-primary btn-block sm:w-auto"
            >
              {committing ? '…' : variance === 0 ? 'No variance' : 'Commit adjustment'}
            </button>
            <button onClick={reset} className="btn-secondary btn-block sm:w-auto">
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
