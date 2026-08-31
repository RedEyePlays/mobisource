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
    <div className="p-6 max-w-md">
      <h2 className="text-lg font-semibold mb-4">Intake donor</h2>
      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <label className="flex flex-col gap-1">
          Model
          <input {...field('model')} className="border rounded px-3 py-2" placeholder="IP14P" required />
        </label>

        <label className="flex flex-col gap-1">
          IMEI (leave blank if unreadable)
          <input {...field('imei')} className="border rounded px-3 py-2" />
        </label>

        {!form.imei && (
          <label className="flex flex-col gap-1">
            Reason IMEI is blank
            <input {...field('imeiBlankReason')} className="border rounded px-3 py-2" required />
          </label>
        )}

        <label className="flex flex-col gap-1">
          Purchase cost
          <input
            {...field('purchaseCost')}
            type="number"
            step="0.01"
            min="0"
            className="border rounded px-3 py-2"
            required
          />
        </label>

        <label className="flex flex-col gap-1">
          Purchase currency
          <select {...field('purchaseCurrency')} className="border rounded px-3 py-2">
            {CURRENCIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>

        {form.purchaseCurrency !== 'CAD' && (
          <label className="flex flex-col gap-1">
            FX rate used (to CAD)
            <input
              {...field('fxRateUsed')}
              type="number"
              step="0.0001"
              min="0"
              className="border rounded px-3 py-2"
              required
            />
          </label>
        )}

        <label className="flex flex-col gap-1">
          Source
          <select {...field('source')} className="border rounded px-3 py-2">
            {SOURCES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1">
          Supplier ref
          <input {...field('supplierRef')} className="border rounded px-3 py-2" />
        </label>

        <label className="flex flex-col gap-1">
          Condition (donor grade)
          <select {...field('condition')} className="border rounded px-3 py-2">
            {CONDITIONS.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>

        {error && <p className="text-red-600 text-sm">{error}</p>}

        {warning && (
          <div className="border border-yellow-500 bg-yellow-50 rounded px-3 py-2 text-sm flex flex-col gap-2">
            <p>{warning}</p>
            <button type="button" onClick={onDone} className="self-start border rounded px-3 py-1">
              Continue anyway
            </button>
          </div>
        )}

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
