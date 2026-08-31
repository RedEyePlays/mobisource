import { useState } from 'react'
import type { ChangeEvent, FormEvent } from 'react'
import { httpsCallable } from 'firebase/functions'
import { functions } from '../firebase'
import type { Buyer, BuyerTerms, BuyerTier, BuyerType } from '../types'

const TYPES: readonly BuyerType[] = ['repairShop', 'broker', 'exporter', 'retail']
const TIERS: readonly BuyerTier[] = ['standard', 'preferred', 'partner']
const TERMS: readonly BuyerTerms[] = ['prepay', 'net7', 'net15']

interface BuyerFormState {
  name: string
  type: BuyerType
  tier: BuyerTier
  terms: BuyerTerms
  email: string
}

// buyer: null for create, or an existing buyer doc's data for edit.
export default function BuyerForm({ buyer, onDone }: { buyer: Buyer | null; onDone: () => void }) {
  const isEdit = Boolean(buyer)

  const [form, setForm] = useState<BuyerFormState>({
    name: buyer?.name ?? '',
    type: buyer?.type ?? TYPES[0],
    tier: buyer?.tier ?? TIERS[0],
    terms: buyer?.terms ?? TERMS[0],
    email: buyer?.contact?.email ?? '',
  })
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  function field<K extends keyof BuyerFormState>(name: K) {
    return {
      value: form[name],
      onChange: (e: ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
        setForm((f) => ({ ...f, [name]: e.target.value as BuyerFormState[K] })),
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setSubmitting(true)
    try {
      const payload = {
        name: form.name,
        type: form.type,
        tier: form.tier,
        terms: form.terms,
        contact: form.email ? { email: form.email } : {},
      }

      if (isEdit && buyer) {
        const updateBuyer = httpsCallable(functions, 'updateBuyer')
        await updateBuyer({ buyerId: buyer.buyerId, ...payload })
      } else {
        const createBuyer = httpsCallable(functions, 'createBuyer')
        await createBuyer(payload)
      }
      onDone()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="p-6 max-w-md">
      <h2 className="text-lg font-semibold mb-4">{isEdit ? `Edit ${buyer!.name}` : 'New buyer'}</h2>
      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <label className="flex flex-col gap-1">
          Name
          <input {...field('name')} className="border rounded px-3 py-2" required />
        </label>

        <label className="flex flex-col gap-1">
          Type
          <select {...field('type')} className="border rounded px-3 py-2">
            {TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1">
          Tier
          <select {...field('tier')} className="border rounded px-3 py-2">
            {TIERS.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1">
          Terms
          <select {...field('terms')} className="border rounded px-3 py-2">
            {TERMS.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1">
          Contact email
          <input {...field('email')} type="email" className="border rounded px-3 py-2" />
        </label>

        {error && <p className="text-red-600 text-sm">{error}</p>}

        <div className="flex gap-2 mt-2">
          <button type="submit" disabled={submitting} className="bg-black text-white rounded px-3 py-2 disabled:opacity-50">
            Save
          </button>
          <button type="button" onClick={onDone} className="border rounded px-3 py-2">
            Cancel
          </button>
        </div>
      </form>
    </div>
  )
}
