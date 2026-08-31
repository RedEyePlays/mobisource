import { useEffect, useMemo, useState } from 'react'
import { collection, getDocs } from 'firebase/firestore'
import { db } from '../firebase.js'

const STATUSES = ['inStock', 'reserved', 'sold', 'scrapped', 'returned']
const GRADES = ['A', 'B', 'C', 'N']

function formatCents(cents) {
  return `$${(cents / 100).toFixed(2)}`
}

function daysInStock(createdAt) {
  if (!createdAt?.toDate) return '—'
  const ms = Date.now() - createdAt.toDate().getTime()
  return Math.max(0, Math.floor(ms / (1000 * 60 * 60 * 24)))
}

export default function StockList() {
  const [items, setItems] = useState([])
  const [skusByCode, setSkusByCode] = useState({})
  const [bulkStock, setBulkStock] = useState([])
  const [loading, setLoading] = useState(true)
  const [refreshKey, setRefreshKey] = useState(0)

  const [skuFilter, setSkuFilter] = useState('')
  const [partTypeFilter, setPartTypeFilter] = useState('')
  const [modelFilter, setModelFilter] = useState('')
  const [gradeFilter, setGradeFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')

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

      const skuMap = {}
      skusSnap.docs.forEach((d) => {
        skuMap[d.id] = d.data()
      })

      setItems(itemsSnap.docs.map((d) => ({ id: d.id, ...d.data() })))
      setSkusByCode(skuMap)
      setBulkStock(bulkSnap.docs.map((d) => d.data()))
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

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold">Stock</h2>
        <button onClick={() => setRefreshKey((k) => k + 1)} className="border rounded px-3 py-1">
          Refresh
        </button>
      </div>

      <div className="border rounded px-4 py-3 mb-4 inline-block">
        <p className="text-sm text-gray-500">Value on hand</p>
        <p className="text-xl font-semibold">{formatCents(valueOnHand)}</p>
      </div>

      <div className="flex flex-wrap gap-2 mb-4">
        <select value={skuFilter} onChange={(e) => setSkuFilter(e.target.value)} className="border rounded px-2 py-1">
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
          className="border rounded px-2 py-1"
        >
          <option value="">All part types</option>
          {partTypes.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
        <select value={modelFilter} onChange={(e) => setModelFilter(e.target.value)} className="border rounded px-2 py-1">
          <option value="">All models</option>
          {models.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
        <select value={gradeFilter} onChange={(e) => setGradeFilter(e.target.value)} className="border rounded px-2 py-1">
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
          className="border rounded px-2 py-1"
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
        <p>Loading…</p>
      ) : filteredItems.length === 0 ? (
        <p className="text-gray-500">No stock items match these filters.</p>
      ) : (
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="border-b">
              <th className="py-2 pr-4">SKU</th>
              <th className="py-2 pr-4">Grade</th>
              <th className="py-2 pr-4">Status</th>
              <th className="py-2 pr-4">Allocated cost</th>
              <th className="py-2 pr-4">Days in stock</th>
            </tr>
          </thead>
          <tbody>
            {filteredItems.map((item) => (
              <tr key={item.id} className="border-b">
                <td className="py-2 pr-4 font-mono text-sm">{item.skuCode}</td>
                <td className="py-2 pr-4">{item.grade}</td>
                <td className="py-2 pr-4">{item.status}</td>
                <td className="py-2 pr-4">{formatCents(item.allocatedCost)}</td>
                <td className="py-2 pr-4">{daysInStock(item.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
