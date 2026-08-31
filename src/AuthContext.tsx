import type { ReactNode } from 'react'
import { createContext, useContext, useEffect, useState } from 'react'
import type { User } from 'firebase/auth'
import { onAuthStateChanged, getIdTokenResult } from 'firebase/auth'
import { auth } from './firebase'

interface AuthState {
  loading: boolean
  user: User | null
  isStaff: boolean
}

const AuthContext = createContext<AuthState>({ loading: true, user: null, isStaff: false })

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ loading: true, user: null, isStaff: false })

  useEffect(() => {
    return onAuthStateChanged(auth, async (user) => {
      if (!user) {
        setState({ loading: false, user: null, isStaff: false })
        return
      }
      const tokenResult = await getIdTokenResult(user, true)
      setState({ loading: false, user, isStaff: tokenResult.claims.staff === true })
    })
  }, [])

  return <AuthContext.Provider value={state}>{children}</AuthContext.Provider>
}

export function useAuth() {
  return useContext(AuthContext)
}
