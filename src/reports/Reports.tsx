import { useEffect, useMemo, useState } from 'react'
import { collection, getDocs } from 'firebase/firestore'
import { db } from '../firebase'
import type { BulkReceipt, Buyer, Donor, Expense, SalesOrder, Sku, StockItem, StockMovement } from '../types'
import DonorRoiReport from './DonorRoiReport'
import MarginReport from './MarginReport'
import YieldReport from './YieldReport'
import AgingReportView from './AgingReportView'
import BuyerRevenueReport from './BuyerRevenueReport'
import AdjustmentsReport from './AdjustmentsReport'
import SalesSummaryReport from './SalesSummaryReport'
import HstRemittanceReport from './HstRemittanceReport'

type ReportTab =
  | 'donorRoi'
  | 'margin'
  | 'yield'
  | 'aging'
  | 'buyerRevenue'
  | 'adjustments'
  | 'salesSummary'
  | 'hstRemittance'

const TABS: { key: ReportTab; label: string }[] = [
  { key: 'donorRoi', label: 'Donor ROI by model' },
  { key: 'margin', label: 'Margin per SKU' },
  { key: 'yield', label: 'Yield rate' },
  { key: 'aging', label: 'Aging' },
  { key: 'buyerRevenue', label: 'Buyer revenue' },
  { key: 'adjustments', label: 'Adjustments' },
  { key: 'salesSummary', label: 'Sales summary' },
  { key: 'hstRemittance', label: 'HST remittance' },
]

export default function Reports() {
  const [tab, setTab] = useState<ReportTab>('donorRoi')
  const [donors, setDonors] = useState<Donor[]>([])
  const [stockItems, setStockItems] = useState<StockItem[]>([])
  const [skus, setSkus] = useState<Sku[]>([])
  const [salesOrders, setSalesOrders] = useState<SalesOrder[]>([])
  const [buyers, setBuyers] = useState<Buyer[]>([])
  const [movements, setMovements] = useState<StockMovement[]>([])
  const [bulkReceipts, setBulkReceipts] = useState<BulkReceipt[]>([])
  const [expenses, setExpenses] = useState<Expense[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshKey, setRefreshKey] = useState(0)

  const now = useMemo(() => new Date(), [refreshKey])

  useEffect(() => {
    let cancelled = false

    async function load() {
      setLoading(true)
      const [donorsSnap, itemsSnap, skusSnap, ordersSnap, buyersSnap, movementsSnap, receiptsSnap, expensesSnap] =
        await Promise.all([
          getDocs(collection(db, 'donors')),
          getDocs(collection(db, 'stockItems')),
          getDocs(collection(db, 'skus')),
          getDocs(collection(db, 'salesOrders')),
          getDocs(collection(db, 'buyers')),
          getDocs(collection(db, 'stockMovements')),
          getDocs(collection(db, 'bulkReceipts')),
          getDocs(collection(db, 'expenses')),
        ])
      if (cancelled) return

      setDonors(donorsSnap.docs.map((d) => ({ id: d.id, ...d.data() }) as Donor))
      setStockItems(itemsSnap.docs.map((d) => ({ id: d.id, ...d.data() }) as StockItem))
      setSkus(skusSnap.docs.map((d) => d.data() as Sku))
      setSalesOrders(ordersSnap.docs.map((d) => d.data() as SalesOrder))
      setBuyers(buyersSnap.docs.map((d) => d.data() as Buyer))
      setMovements(movementsSnap.docs.map((d) => d.data() as StockMovement))
      setBulkReceipts(receiptsSnap.docs.map((d) => d.data() as BulkReceipt))
      setExpenses(expensesSnap.docs.map((d) => d.data() as Expense))
      setLoading(false)
    }

    load()
    return () => {
      cancelled = true
    }
  }, [refreshKey])

  return (
    <div className="p-4 sm:p-6">
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="page-title">Reports</h2>
        <button onClick={() => setRefreshKey((k) => k + 1)} className="btn-secondary btn-sm">
          Refresh
        </button>
      </div>

      <div className="mb-4 overflow-x-auto">
        <div className="flex gap-4 border-b border-slate-200 dark:border-slate-800">
          {TABS.map((t) => (
            <button key={t.key} onClick={() => setTab(t.key)} className={tab === t.key ? 'tab-link-on' : 'tab-link-off'}>
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <p className="text-muted">Loading…</p>
      ) : (
        <>
          {tab === 'donorRoi' && <DonorRoiReport donors={donors} stockItems={stockItems} />}
          {tab === 'margin' && <MarginReport stockItems={stockItems} />}
          {tab === 'yield' && <YieldReport stockItems={stockItems} skus={skus} />}
          {tab === 'aging' && <AgingReportView stockItems={stockItems} now={now} />}
          {tab === 'buyerRevenue' && <BuyerRevenueReport salesOrders={salesOrders} buyers={buyers} />}
          {tab === 'adjustments' && <AdjustmentsReport movements={movements} />}
          {tab === 'salesSummary' && <SalesSummaryReport salesOrders={salesOrders} />}
          {tab === 'hstRemittance' && (
            <HstRemittanceReport salesOrders={salesOrders} bulkReceipts={bulkReceipts} expenses={expenses} />
          )}
        </>
      )}
    </div>
  )
}
