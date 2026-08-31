import { useState } from 'react'
import { AuthProvider, useAuth } from './AuthContext'
import SignIn from './SignIn'
import DonorList from './donors/DonorList'
import DonorForm from './donors/DonorForm'
import SkuList from './skus/SkuList'
import SkuForm from './skus/SkuForm'
import BuyerList from './buyers/BuyerList'
import BuyerForm from './buyers/BuyerForm'
import OrderList from './orders/OrderList'
import OrderBuilder from './orders/OrderBuilder'
import ReturnForm from './orders/ReturnForm'
import StockList from './inventory/StockList'
import Reports from './reports/Reports'
import TeardownScreen from './teardown/TeardownScreen'
import ReceivingScreen from './receiving/ReceivingScreen'
import PosScreen from './pos/PosScreen'
import type { Buyer, SalesOrder, Sku } from './types'

type Section = 'pos' | 'inventory' | 'donors' | 'teardown' | 'skus' | 'buyers' | 'orders' | 'receiving' | 'reports'
type View = 'list' | 'form' | 'return'

const NAV: { key: Section; label: string }[] = [
  { key: 'pos', label: 'Sell' },
  { key: 'inventory', label: 'Inventory' },
  { key: 'donors', label: 'Donors' },
  { key: 'teardown', label: 'Teardown' },
  { key: 'skus', label: 'SKUs' },
  { key: 'buyers', label: 'Buyers' },
  { key: 'orders', label: 'Orders' },
  { key: 'receiving', label: 'Receiving' },
  { key: 'reports', label: 'Reports' },
]

function AppShell() {
  const { loading, user, isStaff } = useAuth()
  const [section, setSection] = useState<Section>('pos')
  const [view, setView] = useState<View>('list')
  const [editingRecord, setEditingRecord] = useState<Sku | Buyer | null>(null)
  const [returningOrder, setReturningOrder] = useState<SalesOrder | null>(null)

  if (loading) {
    return null
  }

  if (!user) {
    return <SignIn />
  }

  if (!isStaff) {
    return (
      <div className="surface-page flex items-center justify-center p-6 text-center">
        <p className="text-muted text-base">Signed in, but this account isn't authorized for MobiSource.</p>
      </div>
    )
  }

  function goToSection(next: Section) {
    setSection(next)
    setView('list')
    setEditingRecord(null)
    setReturningOrder(null)
  }

  return (
    <div className="surface-page">
      <nav className="sticky top-0 z-10 flex gap-1.5 overflow-x-auto border-b border-slate-200 bg-white/95 px-3 py-2.5 backdrop-blur-sm dark:border-slate-800 dark:bg-slate-950/95">
        {NAV.map((item) => (
          <button
            key={item.key}
            onClick={() => goToSection(item.key)}
            className={section === item.key ? 'nav-link-on' : 'nav-link-off'}
          >
            {item.label}
          </button>
        ))}
      </nav>

      {section === 'pos' && <PosScreen />}

      {section === 'inventory' && <StockList />}

      {section === 'donors' && view === 'list' && <DonorList onIntake={() => setView('form')} />}
      {section === 'donors' && view === 'form' && <DonorForm onDone={() => setView('list')} />}

      {section === 'teardown' && <TeardownScreen />}

      {section === 'skus' && view === 'list' && (
        <SkuList
          onCreate={() => {
            setEditingRecord(null)
            setView('form')
          }}
          onEdit={(sku) => {
            setEditingRecord(sku)
            setView('form')
          }}
        />
      )}
      {section === 'skus' && view === 'form' && (
        <SkuForm sku={editingRecord as Sku | null} onDone={() => setView('list')} />
      )}

      {section === 'buyers' && view === 'list' && (
        <BuyerList
          onCreate={() => {
            setEditingRecord(null)
            setView('form')
          }}
          onEdit={(buyer) => {
            setEditingRecord(buyer)
            setView('form')
          }}
        />
      )}
      {section === 'buyers' && view === 'form' && (
        <BuyerForm buyer={editingRecord as Buyer | null} onDone={() => setView('list')} />
      )}

      {section === 'orders' && view === 'list' && (
        <OrderList
          onCreate={() => setView('form')}
          onReturn={(order) => {
            setReturningOrder(order)
            setView('return')
          }}
        />
      )}
      {section === 'orders' && view === 'form' && <OrderBuilder onDone={() => setView('list')} />}
      {section === 'orders' && view === 'return' && returningOrder && (
        <ReturnForm order={returningOrder} onDone={() => setView('list')} />
      )}

      {section === 'receiving' && <ReceivingScreen />}

      {section === 'reports' && <Reports />}
    </div>
  )
}

function App() {
  return (
    <AuthProvider>
      <AppShell />
    </AuthProvider>
  )
}

export default App
