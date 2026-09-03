import { useState } from 'react'
import type { FormEvent } from 'react'
import { httpsCallable } from 'firebase/functions'
import { functions } from '../firebase'

function isoToday(): string {
  return new Date().toISOString().slice(0, 10)
}

function dollarsToCents(value: string): number {
  return Math.round(Number(value) * 100)
}

export default function ExpenseForm({ onDone }: { onDone: () => void }) {
  const [date, setDate] = useState(isoToday())
  const [description, setDescription] = useState('')
  const [amount, setAmount] = useState('')
  const [hstPaid, setHstPaid] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setSubmitting(true)
    try {
      const recordExpense = httpsCallable(functions, 'recordExpense')
      await recordExpense({
        date,
        description,
        amount: dollarsToCents(amount),
        hstPaidCAD: hstPaid ? dollarsToCents(hstPaid) : 0,
      })
      onDone()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="mx-auto max-w-md p-4 sm:p-6">
      <h2 className="page-title mb-4">Record an expense</h2>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <label className="field">
          Date
          <input value={date} onChange={(e) => setDate(e.target.value)} type="date" className="input" required />
        </label>

        <label className="field">
          Description
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="e.g. Shop rent — August"
            className="input"
            required
          />
        </label>

        <label className="field">
          Amount (CAD, tax included)
          <input
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            type="number"
            step="0.01"
            min="0"
            className="input"
            required
          />
        </label>

        <label className="field">
          HST paid (if any)
          <input
            value={hstPaid}
            onChange={(e) => setHstPaid(e.target.value)}
            type="number"
            step="0.01"
            min="0"
            placeholder="0.00"
            className="input"
          />
        </label>

        {error && <p className="banner-danger">{error}</p>}

        <div className="mt-2 flex flex-col gap-2 sm:flex-row">
          <button type="submit" disabled={submitting} className="btn-primary sm:flex-1">
            Save
          </button>
          <button type="button" onClick={onDone} className="btn-secondary sm:flex-1">
            Cancel
          </button>
        </div>
      </form>
    </div>
  )
}
