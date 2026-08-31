import { useEffect, useMemo, useState } from 'react'
import { collection, getDocs } from 'firebase/firestore'
import { db } from '../firebase'
import type { Buyer, Donor, SalesOrder, Sku, StockItem } from '../types'
import DonorRoiReport from './DonorRoiReport'
import MarginReport from './MarginReport'
import YieldReport from './YieldReport'
import AgingReportView from './AgingReportView'
import BuyerRevenueReport from './BuyerRevenueReport'

type ReportTab = 'donorRoi' | 'margin' | 'yield' | 'aging' | 'buyerRevenue'

const TABS: { key: ReportTab; label: string }[] = [
  { key: 'donorRoi', label: 'Donor ROI by model' },
  { key: 'margin', label: 'Margin per SKU' },
  { key: 'yield', label: 'Yield rate' },
  { key: 'aging', label: 'Aging' },
  { key: 'buyerRevenue', label: 'Buyer revenue' },
]

export default function Reports() {
  const [tab, setTab] = useState<ReportTab>('donorRoi')
  const [donors, setDonors] = useState<Donor[]>([])
  const [stockItems, setStockItems] = useState<StockItem[]>([])
  const [skus, setSkus] = useState<Sku[]>([])
  const [salesOrders, setSalesOrders] = useState<SalesOrder[]>([])
  const [buyers, setBuyers] = useState<Buyer[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshKey, setRefreshKey] = useState(0)

  const now = useMemo(() => new Date(), [refreshKey])

  useEffect(() => {
    let cancelled = false

    async function load() {
      setLoading(true)
      const [donorsSnap, itemsSnap, skusSnap, ordersSnap, buyersSnap] = await Promise.all([
        getDocs(collection(db, 'donors')),
        getDocs(collection(db, 'stockItems')),
        getDocs(collection(db, 'skus')),
        getDocs(collection(db, 'salesOrders')),
        getDocs(collection(db, 'buyers')),
      ])
      if (cancelled) return

      setDonors(donorsSnap.docs.map((d) => ({ id: d.id, ...d.data() }) as Donor))
      setStockItems(itemsSnap.docs.map((d) => ({ id: d.id, ...d.data() }) as StockItem))
      setSkus(skusSnap.docs.map((d) => d.data() as Sku))
      setSalesOrders(ordersSnap.docs.map((d) => d.data() as SalesOrder))
      setBuyers(buyersSnap.docs.map((d) => d.data() as Buyer))
      setLoading(false)
    }

    load()
    return () => {
      cancelled = true
    }
  }, [refreshKey])

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold">Reports</h2>
        <button onClick={() => setRefreshKey((k) => k + 1)} className="border rounded px-3 py-1">
          Refresh
        </button>
      </div>

      <div className="flex flex-wrap gap-2 mb-4 border-b">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`pb-2 px-1 ${tab === t.key ? 'font-semibold border-b-2 border-black' : 'text-gray-500'}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {loading ? (
        <p>Loading…</p>
      ) : (
        <>
          {tab === 'donorRoi' && <DonorRoiReport donors={donors} stockItems={stockItems} />}
          {tab === 'margin' && <MarginReport stockItems={stockItems} />}
          {tab === 'yield' && <YieldReport stockItems={stockItems} skus={skus} />}
          {tab === 'aging' && <AgingReportView stockItems={stockItems} now={now} />}
          {tab === 'buyerRevenue' && <BuyerRevenueReport salesOrders={salesOrders} buyers={buyers} />}
        </>
      )}
    </div>
  )
}
