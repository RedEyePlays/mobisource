import { useEffect, useState } from 'react'
import { collection, getDocs, orderBy, query } from 'firebase/firestore'
import { db } from '../firebase'
import type { Cents, Expense } from '../types'

function formatCents(cents: Cents) {
  return `$${(cents / 100).toFixed(2)}`
}

export default function ExpenseList({ onRecord }: { onRecord: () => void }) {
  const [expenses, setExpenses] = useState<Expense[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshKey, setRefreshKey] = useState(0)

  useEffect(() => {
    let cancelled = false

    async function load() {
      setLoading(true)
      const snap = await getDocs(query(collection(db, 'expenses'), orderBy('date', 'desc')))
      if (!cancelled) {
        setExpenses(snap.docs.map((d) => d.data() as Expense))
        setLoading(false)
      }
    }

    load()
    return () => {
      cancelled = true
    }
  }, [refreshKey])

  return (
    <div className="p-4 sm:p-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h2 className="page-title">Expenses</h2>
        <div className="flex flex-wrap gap-2">
          <button onClick={() => setRefreshKey((k) => k + 1)} className="btn-secondary btn-sm">
            Refresh
          </button>
          <button onClick={onRecord} className="btn-primary btn-sm">
            Record expense
          </button>
        </div>
      </div>

      {loading ? (
        <p className="text-muted">Loading…</p>
      ) : expenses.length === 0 ? (
        <p className="text-muted">No expenses recorded yet.</p>
      ) : (
        <div className="table-wrap">
          <table className="table-base">
            <thead>
              <tr>
                <th>Date</th>
                <th>Description</th>
                <th>Amount</th>
                <th>HST paid</th>
              </tr>
            </thead>
            <tbody>
              {expenses.map((expense) => (
                <tr key={expense.expenseId}>
                  <td>{expense.date.toDate().toLocaleDateString()}</td>
                  <td>{expense.description}</td>
                  <td>{formatCents(expense.amount)}</td>
                  <td>
                    <span className="num-md">{formatCents(expense.hstPaidCAD)}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
