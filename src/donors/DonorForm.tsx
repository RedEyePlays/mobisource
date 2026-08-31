import { useState } from 'react'
import type { ChangeEvent, FormEvent } from 'react'
import { httpsCallable } from 'firebase/functions'
import { functions } from '../firebase'
import type { DonorCondition, DonorSource, PurchaseCurrency } from '../types'

const CONDITIONS: readonly DonorCondition[] = ['A', 'B', 'C', 'D']
const SOURCES: readonly DonorSource[] = ['local', 'china', 'trade-in']
const CURRENCIES: readonly PurchaseCurrency[] = ['CAD', 'USD']

interface DonorFormState {
  model: string
  imei: string
  imeiBlankReason: string
  purchaseCost: string
  purchaseCurrency: PurchaseCurrency
  fxRateUsed: string
  source: DonorSource
  supplierRef: string
  condition: DonorCondition
}

const initialForm: DonorFormState = {
  model: '',
  imei: '',
  imeiBlankReason: '',
  purchaseCost: '',
  purchaseCurrency: 'CAD',
  fxRateUsed: '',
  source: 'local',
  supplierRef: '',
  condition: 'A',
}

interface IntakeDonorResult {
  donorId: string
  warning: string | null
}

export default function DonorForm({ onDone }: { onDone: () => void }) {
  const [form, setForm] = useState<DonorFormState>(initialForm)
  const [error, setError] = useState('')
  const [warning, setWarning] = useState('')
  const [submitting, setSubmitting] = useState(false)

  function field<K extends keyof DonorFormState>(name: K) {
    return {
      value: form[name],
      onChange: (e: ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
        setForm((f) => ({ ...f, [name]: e.target.value as DonorFormState[K] })),
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setWarning('')
    setSubmitting(true)
    try {
      const intakeDonor = httpsCallable<Record<string, unknown>, IntakeDonorResult>(functions, 'intakeDonor')
      const result = await intakeDonor({
        model: form.model,
        imei: form.imei,
        imeiBlankReason: form.imeiBlankReason,
        purchaseCost: Math.round(Number(form.purchaseCost) * 100),
        purchaseCurrency: form.purchaseCurrency,
        fxRateUsed: form.purchaseCurrency === 'CAD' ? null : Number(form.fxRateUsed),
        source: form.source,
        supplierRef: form.supplierRef,
        condition: form.condition,
      })

      if (result.data.warning) {
        setWarning(result.data.warning)
      } else {
        onDone()
      }
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="p-4 sm:p-6 md:mx-auto md:max-w-md">
      <h2 className="page-title mb-4">Intake donor</h2>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <label className="field">
          Model
          <input {...field('model')} className="input" placeholder="IP14P" required />
        </label>

        <label className="field">
          IMEI (leave blank if unreadable)
          <input {...field('imei')} className="input" />
        </label>

        {!form.imei && (
          <label className="field">
            Reason IMEI is blank
            <input {...field('imeiBlankReason')} className="input" required />
          </label>
        )}

        <label className="field">
          Purchase cost
          <input
            {...field('purchaseCost')}
            type="number"
            step="0.01"
            min="0"
            className="input"
            required
          />
        </label>

        <label className="field">
          Purchase currency
          <select {...field('purchaseCurrency')} className="select">
            {CURRENCIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>

        {form.purchaseCurrency !== 'CAD' && (
          <label className="field">
            FX rate used (to CAD)
            <input
              {...field('fxRateUsed')}
              type="number"
              step="0.0001"
              min="0"
              className="input"
              required
            />
          </label>
        )}

        <label className="field">
          Source
          <select {...field('source')} className="select">
            {SOURCES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          Supplier ref
          <input {...field('supplierRef')} className="input" />
        </label>

        <label className="field">
          Condition (donor grade)
          <select {...field('condition')} className="select">
            {CONDITIONS.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>

        {error && <p className="text-danger text-sm">{error}</p>}

        {warning && (
          <div className="banner-warning flex flex-col gap-2">
            <p>{warning}</p>
            <button type="button" onClick={onDone} className="btn-secondary btn-sm self-start">
              Continue anyway
            </button>
          </div>
        )}

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
