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
import StockList from './inventory/StockList'
import Reports from './reports/Reports'
import type { Buyer, Sku } from './types'

type Section = 'inventory' | 'donors' | 'skus' | 'buyers' | 'orders' | 'reports'
type View = 'list' | 'form'

function AppShell() {
  const { loading, user, isStaff } = useAuth()
  const [section, setSection] = useState<Section>('donors')
  const [view, setView] = useState<View>('list')
  const [editingRecord, setEditingRecord] = useState<Sku | Buyer | null>(null)

  if (loading) {
    return null
  }

  if (!user) {
    return <SignIn />
  }

  if (!isStaff) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p>Signed in, but this account isn't authorized for MobiSource.</p>
      </div>
    )
  }

  function goToSection(next: Section) {
    setSection(next)
    setView('list')
    setEditingRecord(null)
  }

  return (
    <div>
      <nav className="flex gap-2 p-4 border-b">
        <button
          onClick={() => goToSection('inventory')}
          className={section === 'inventory' ? 'font-semibold' : 'text-gray-500'}
        >
          Inventory
        </button>
        <button
          onClick={() => goToSection('donors')}
          className={section === 'donors' ? 'font-semibold' : 'text-gray-500'}
        >
          Donors
        </button>
        <button
          onClick={() => goToSection('skus')}
          className={section === 'skus' ? 'font-semibold' : 'text-gray-500'}
        >
          SKUs
        </button>
        <button
          onClick={() => goToSection('buyers')}
          className={section === 'buyers' ? 'font-semibold' : 'text-gray-500'}
        >
          Buyers
        </button>
        <button
          onClick={() => goToSection('orders')}
          className={section === 'orders' ? 'font-semibold' : 'text-gray-500'}
        >
          Orders
        </button>
        <button
          onClick={() => goToSection('reports')}
          className={section === 'reports' ? 'font-semibold' : 'text-gray-500'}
        >
          Reports
        </button>
      </nav>

      {section === 'inventory' && <StockList />}

      {section === 'donors' && view === 'list' && <DonorList onIntake={() => setView('form')} />}
      {section === 'donors' && view === 'form' && <DonorForm onDone={() => setView('list')} />}

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

      {section === 'orders' && view === 'list' && <OrderList onCreate={() => setView('form')} />}
      {section === 'orders' && view === 'form' && <OrderBuilder onDone={() => setView('list')} />}

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
