import { useState } from 'react'
import { AuthProvider, useAuth } from './AuthContext.jsx'
import SignIn from './SignIn.jsx'
import DonorList from './donors/DonorList.jsx'
import DonorForm from './donors/DonorForm.jsx'

function AppShell() {
  const { loading, user, isStaff } = useAuth()
  const [view, setView] = useState('donors')

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

  return (
    <div>
      {view === 'donors' && <DonorList onIntake={() => setView('donor-form')} />}
      {view === 'donor-form' && <DonorForm onDone={() => setView('donors')} />}
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
