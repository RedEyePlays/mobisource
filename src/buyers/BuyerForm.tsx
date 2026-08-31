import { useState } from 'react'
import type { ChangeEvent, FormEvent } from 'react'
import { httpsCallable } from 'firebase/functions'
import { functions } from '../firebase'
import type { Buyer, BuyerTaxStatus, BuyerTerms, BuyerTier, BuyerType } from '../types'

const TYPES: readonly BuyerType[] = ['repairShop', 'broker', 'exporter', 'retail']
const TIERS: readonly BuyerTier[] = ['standard', 'preferred', 'partner']
const TERMS: readonly BuyerTerms[] = ['prepay', 'net7', 'net15']
const TAX_STATUSES: readonly BuyerTaxStatus[] = ['taxable', 'exempt', 'zeroRated']

interface BuyerFormState {
  name: string
  type: BuyerType
  tier: BuyerTier
  terms: BuyerTerms
  email: string
  taxStatus: BuyerTaxStatus
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
    taxStatus: buyer?.taxStatus ?? 'taxable',
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
        taxStatus: form.taxStatus,
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
    <div className="p-4 sm:p-6 md:mx-auto md:max-w-md">
      <h2 className="page-title mb-4">{isEdit ? `Edit ${buyer!.name}` : 'New buyer'}</h2>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <label className="field">
          Name
          <input {...field('name')} className="input" required />
        </label>

        <label className="field">
          Type
          <select {...field('type')} className="select">
            {TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          Tier
          <select {...field('tier')} className="select">
            {TIERS.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          Terms
          <select {...field('terms')} className="select">
            {TERMS.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          Contact email
          <input {...field('email')} type="email" className="input" />
        </label>

        <label className="field">
          Tax status
          <select {...field('taxStatus')} className="select">
            {TAX_STATUSES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>

        {error && <p className="text-danger text-sm">{error}</p>}

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
