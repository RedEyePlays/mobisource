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
      <div className="flex flex-wrap gap-2 px-6 pt-4 border-b">
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

      {tab === 'receive' && <BulkReceiveForm onDone={() => setTab('stock')} />}
      {tab === 'pending' && <PendingShipping />}
      {tab === 'stock' && <BulkStockList />}
    </div>
  )
}
