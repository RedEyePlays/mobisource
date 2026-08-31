import { useEffect, useMemo, useState } from 'react'
import { collection, getDocs } from 'firebase/firestore'
import type { Timestamp } from 'firebase/firestore'
import { db } from '../firebase'
import { printHarvestedLabel } from '../printing/printClient'
import type { BulkStock, Cents, Grade, Sku, StockItem, StockItemStatus } from '../types'

const STATUSES: readonly StockItemStatus[] = ['inStock', 'reserved', 'sold', 'scrapped', 'returned']
const GRADES: readonly Grade[] = ['A', 'B', 'C', 'N']

function formatCents(cents: Cents) {
  return `$${(cents / 100).toFixed(2)}`
}

function daysInStock(createdAt: Timestamp | undefined) {
  if (!createdAt?.toDate) return '—'
  const ms = Date.now() - createdAt.toDate().getTime()
  return Math.max(0, Math.floor(ms / (1000 * 60 * 60 * 24)))
}

export default function StockList() {
  const [items, setItems] = useState<StockItem[]>([])
  const [skusByCode, setSkusByCode] = useState<Record<string, Sku>>({})
  const [bulkStock, setBulkStock] = useState<BulkStock[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshKey, setRefreshKey] = useState(0)

  const [skuFilter, setSkuFilter] = useState('')
  const [partTypeFilter, setPartTypeFilter] = useState('')
  const [modelFilter, setModelFilter] = useState('')
  const [gradeFilter, setGradeFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')

  const [printingId, setPrintingId] = useState<string | null>(null)
  const [printStatus, setPrintStatus] = useState<Record<string, 'ok' | 'error' | undefined>>({})

  useEffect(() => {
    let cancelled = false

    async function load() {
      setLoading(true)
      const [itemsSnap, skusSnap, bulkSnap] = await Promise.all([
        getDocs(collection(db, 'stockItems')),
        getDocs(collection(db, 'skus')),
        getDocs(collection(db, 'bulkStock')),
      ])
      if (cancelled) return

      const skuMap: Record<string, Sku> = {}
      skusSnap.docs.forEach((d) => {
        skuMap[d.id] = d.data() as Sku
      })

      setItems(itemsSnap.docs.map((d) => ({ id: d.id, ...d.data() }) as StockItem))
      setSkusByCode(skuMap)
      setBulkStock(bulkSnap.docs.map((d) => d.data() as BulkStock))
      setLoading(false)
    }

    load()
    return () => {
      cancelled = true
    }
  }, [refreshKey])

  const partTypes = useMemo(
    () => [...new Set(Object.values(skusByCode).map((s) => s.partType))].sort(),
    [skusByCode],
  )
  const models = useMemo(() => [...new Set(Object.values(skusByCode).map((s) => s.model))].sort(), [skusByCode])

  const filteredItems = items.filter((item) => {
    const sku = skusByCode[item.skuCode]
    if (skuFilter && item.skuCode !== skuFilter) return false
    if (partTypeFilter && sku?.partType !== partTypeFilter) return false
    if (modelFilter && sku?.model !== modelFilter) return false
    if (gradeFilter && item.grade !== gradeFilter) return false
    if (statusFilter && item.status !== statusFilter) return false
    return true
  })

  // Value on hand is always over ALL inStock items, independent of the
  // filters above — it's a standing total, not a filtered view.
  const stockItemsValue = items
    .filter((item) => item.status === 'inStock')
    .reduce((sum, item) => sum + item.allocatedCost, 0)
  const bulkStockValue = bulkStock.reduce((sum, b) => sum + b.qtyOnHand * b.avgLandedCost, 0)
  const valueOnHand = stockItemsValue + bulkStockValue

  async function handlePrint(item: StockItem) {
    setPrintingId(item.id)
    setPrintStatus((s) => ({ ...s, [item.id]: undefined }))
    try {
      const model = skusByCode[item.skuCode]?.model ?? ''
      await printHarvestedLabel({ itemId: item.itemId, skuCode: item.skuCode, grade: item.grade, model })
      setPrintStatus((s) => ({ ...s, [item.id]: 'ok' }))
    } catch {
      setPrintStatus((s) => ({ ...s, [item.id]: 'error' }))
    } finally {
      setPrintingId(null)
    }
  }

  return (
    <div className="p-4 sm:p-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h2 className="page-title">Stock</h2>
        <button onClick={() => setRefreshKey((k) => k + 1)} className="btn-secondary btn-sm">
          Refresh
        </button>
      </div>

      <div className="card mb-4 inline-block px-4 py-3">
        <p className="eyebrow">Value on hand</p>
        <p className="num-hero">{formatCents(valueOnHand as Cents)}</p>
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        <select value={skuFilter} onChange={(e) => setSkuFilter(e.target.value)} className="select w-auto">
          <option value="">All SKUs</option>
          {Object.keys(skusByCode)
            .sort()
            .map((code) => (
              <option key={code} value={code}>
                {code}
              </option>
            ))}
        </select>
        <select
          value={partTypeFilter}
          onChange={(e) => setPartTypeFilter(e.target.value)}
          className="select w-auto"
        >
          <option value="">All part types</option>
          {partTypes.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
        <select value={modelFilter} onChange={(e) => setModelFilter(e.target.value)} className="select w-auto">
          <option value="">All models</option>
          {models.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
        <select value={gradeFilter} onChange={(e) => setGradeFilter(e.target.value)} className="select w-auto">
          <option value="">All grades</option>
          {GRADES.map((g) => (
            <option key={g} value={g}>
              {g}
            </option>
          ))}
        </select>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="select w-auto"
        >
          <option value="">All statuses</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </div>

      {loading ? (
        <p className="text-muted">Loading…</p>
      ) : filteredItems.length === 0 ? (
        <p className="text-muted">No stock items match these filters.</p>
      ) : (
        <div className="table-wrap">
          <table className="table-base">
            <thead>
              <tr>
                <th>SKU</th>
                <th>Grade</th>
                <th>Status</th>
                <th>Allocated cost</th>
                <th>Days in stock</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filteredItems.map((item) => (
                <tr key={item.id}>
                  <td className="font-mono text-sm">{item.skuCode}</td>
                  <td>{item.grade}</td>
                  <td>{item.status}</td>
                  <td className="num-md">{formatCents(item.allocatedCost)}</td>
                  <td>{daysInStock(item.createdAt)}</td>
                  <td>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handlePrint(item)}
                        disabled={printingId === item.id}
                        className="btn-secondary btn-sm"
                      >
                        {printingId === item.id ? 'Printing…' : 'Print label'}
                      </button>
                      {printStatus[item.id] === 'ok' && <span className="text-xs text-emerald-600 dark:text-emerald-400">Printed</span>}
                      {printStatus[item.id] === 'error' && <span className="text-danger text-xs">Failed</span>}
                    </div>
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
