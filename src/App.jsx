import { useState } from 'react'
import { AuthProvider, useAuth } from './AuthContext.jsx'
import SignIn from './SignIn.jsx'
import DonorList from './donors/DonorList.jsx'
import DonorForm from './donors/DonorForm.jsx'
import SkuList from './skus/SkuList.jsx'
import SkuForm from './skus/SkuForm.jsx'
import BuyerList from './buyers/BuyerList.jsx'
import BuyerForm from './buyers/BuyerForm.jsx'
import OrderList from './orders/OrderList.jsx'
import OrderBuilder from './orders/OrderBuilder.jsx'

function AppShell() {
  const { loading, user, isStaff } = useAuth()
  const [section, setSection] = useState('donors')
  const [view, setView] = useState('list')
  const [editingRecord, setEditingRecord] = useState(null)

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

  function goToSection(next) {
    setSection(next)
    setView('list')
    setEditingRecord(null)
  }

  return (
    <div>
      <nav className="flex gap-2 p-4 border-b">
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
      </nav>

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
      {section === 'skus' && view === 'form' && <SkuForm sku={editingRecord} onDone={() => setView('list')} />}

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
        <BuyerForm buyer={editingRecord} onDone={() => setView('list')} />
      )}

      {section === 'orders' && view === 'list' && <OrderList onCreate={() => setView('form')} />}
      {section === 'orders' && view === 'form' && <OrderBuilder onDone={() => setView('list')} />}
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
