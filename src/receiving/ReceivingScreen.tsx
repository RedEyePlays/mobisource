import { useState } from 'react'
import BulkReceiveForm from './BulkReceiveForm'
import PendingShipping from './PendingShipping'
import BulkStockList from './BulkStockList'

type Tab = 'receive' | 'pending' | 'stock'

const TABS: { key: Tab; label: string }[] = [
  { key: 'receive', label: 'Receive shipment' },
  { key: 'pending', label: 'Shipping pending' },
  { key: 'stock', label: 'Bulk stock' },
]

export default function ReceivingScreen() {
  const [tab, setTab] = useState<Tab>('receive')

  return (
    <div>
      <div className="flex gap-2 overflow-x-auto border-b border-slate-200 px-4 pt-4 sm:px-6 dark:border-slate-800">
        {TABS.map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)} className={tab === t.key ? 'tab-link-on' : 'tab-link-off'}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'receive' && <BulkReceiveForm onDone={() => setTab('stock')} />}
      {tab === 'pending' && <PendingShipping />}
      {tab === 'stock' && <BulkStockList />}
    </div>
  )
}
