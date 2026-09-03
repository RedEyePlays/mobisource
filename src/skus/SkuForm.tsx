import { useState } from 'react'
import type { ChangeEvent, FormEvent } from 'react'
import { httpsCallable } from 'firebase/functions'
import { functions } from '../firebase'
import type { Grade, PartType, Sku, Source, TrackingMode } from '../types'

// Mirrors functions/src/lib/generateSkuCode.ts's enums (docs/SCHEMA.md §1).
// Not imported directly — the frontend bundle and the functions codebase
// are deployed independently, and this list is small enough to duplicate
// rather than reach across that boundary.
const PART_TYPES: readonly PartType[] = [
  'SCRN', 'LOGIC', 'HOUSASM', 'HOUS', 'BGLS', 'BATT', 'CAMR', 'CAMF',
  'CHRG', 'NFC', 'SPKR', 'EARP', 'PROX', 'FLSH', 'TAPT',
]
const GRADES: readonly Grade[] = ['A', 'B', 'C', 'N']
const SOURCES: readonly Source[] = ['PULL', 'AFT', 'OEM']
const TRACKING_MODES: readonly TrackingMode[] = ['serialized', 'bulk']

function centsToDollarsString(cents: number | undefined) {
  return cents == null ? '' : (cents / 100).toFixed(2)
}

function dollarsStringToCents(value: string) {
  return Math.round(Number(value) * 100)
}

interface SkuFormState {
  partType: PartType
  model: string
  grade: Grade
  source: Source
  trackingMode: TrackingMode
  listPriceRetail: string
  listPriceTier1: string
  listPriceTier2: string
  listPriceTier3: string
  expectedResale: string
}

// sku: null for create, or an existing SKU doc's data for edit (identity
// fields become read-only — see updateSku's immutable-fields rule).
export default function SkuForm({ sku, onDone }: { sku: Sku | null; onDone: () => void }) {
  const isEdit = Boolean(sku)

  const [form, setForm] = useState<SkuFormState>({
    partType: sku?.partType ?? PART_TYPES[0],
    model: sku?.model ?? '',
    grade: sku?.grade ?? GRADES[0],
    source: sku?.source ?? SOURCES[0],
    trackingMode: sku?.trackingMode ?? TRACKING_MODES[0],
    listPriceRetail: centsToDollarsString(sku?.listPriceRetail),
    listPriceTier1: centsToDollarsString(sku?.listPriceTier1),
    listPriceTier2: centsToDollarsString(sku?.listPriceTier2),
    listPriceTier3: centsToDollarsString(sku?.listPriceTier3),
    expectedResale: centsToDollarsString(sku?.expectedResale),
  })
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  function field<K extends keyof SkuFormState>(name: K) {
    return {
      value: form[name],
      onChange: (e: ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
        setForm((f) => ({ ...f, [name]: e.target.value as SkuFormState[K] })),
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setSubmitting(true)
    try {
      const pricing = {
        listPriceRetail: dollarsStringToCents(form.listPriceRetail),
        listPriceTier1: dollarsStringToCents(form.listPriceTier1),
        listPriceTier2: dollarsStringToCents(form.listPriceTier2),
        listPriceTier3: dollarsStringToCents(form.listPriceTier3),
        expectedResale: dollarsStringToCents(form.expectedResale),
      }

      if (isEdit && sku) {
        const updateSku = httpsCallable(functions, 'updateSku')
        await updateSku({ skuCode: sku.skuCode, ...pricing })
      } else {
        const createSku = httpsCallable(functions, 'createSku')
        await createSku({
          partType: form.partType,
          model: form.model,
          grade: form.grade,
          source: form.source,
          trackingMode: form.trackingMode,
          ...pricing,
        })
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
      <h2 className="page-title mb-4">{isEdit ? `Edit ${sku!.skuCode}` : 'New SKU'}</h2>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <label className="field">
          Part type
          <select {...field('partType')} disabled={isEdit} className="select">
            {PART_TYPES.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          Model
          <input {...field('model')} disabled={isEdit} className="input" placeholder="IP14P" required />
        </label>

        <label className="field">
          Grade
          <select {...field('grade')} disabled={isEdit} className="select">
            {GRADES.map((g) => (
              <option key={g} value={g}>
                {g}
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          Source
          <select {...field('source')} disabled={isEdit} className="select">
            {SOURCES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          Tracking mode
          <select {...field('trackingMode')} disabled={isEdit} className="select">
            {TRACKING_MODES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>

        {isEdit && (
          <p className="text-muted text-sm">
            Part type, model, grade, source, and tracking mode are locked — create a new SKU to change them.
          </p>
        )}

        <label className="field">
          Expected resale
          <input {...field('expectedResale')} type="number" step="0.01" min="0" className="input" required />
        </label>

        <label className="field">
          Retail price
          <input {...field('listPriceRetail')} type="number" step="0.01" min="0" className="input" required />
        </label>

        <label className="field">
          Tier 1 price (1-4 units)
          <input {...field('listPriceTier1')} type="number" step="0.01" min="0" className="input" required />
        </label>

        <label className="field">
          Tier 2 price (5-19 units)
          <input {...field('listPriceTier2')} type="number" step="0.01" min="0" className="input" required />
        </label>

        <label className="field">
          Tier 3 price (20+ units)
          <input {...field('listPriceTier3')} type="number" step="0.01" min="0" className="input" required />
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
