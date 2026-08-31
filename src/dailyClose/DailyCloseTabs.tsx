import { useState } from 'react'
import DailyCloseScreen from './DailyCloseScreen'
import CloseList from './CloseList'

type Tab = 'close' | 'history'

const TABS: { key: Tab; label: string }[] = [
  { key: 'close', label: 'Close today' },
  { key: 'history', label: 'History' },
]

export default function DailyCloseTabs() {
  const [tab, setTab] = useState<Tab>('close')

  return (
    <div>
      <div className="flex gap-2 overflow-x-auto border-b border-slate-200 px-4 pt-4 sm:px-6 dark:border-slate-800">
        {TABS.map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)} className={tab === t.key ? 'tab-link-on' : 'tab-link-off'}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'close' && <DailyCloseScreen />}
      {tab === 'history' && <CloseList />}
    </div>
  )
}
