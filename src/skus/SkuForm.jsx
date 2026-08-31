import { useState } from 'react'
import { httpsCallable } from 'firebase/functions'
import { functions } from '../firebase.js'

// Mirrors functions/src/lib/generateSkuCode.js's enums (docs/SCHEMA.md §1).
// Not imported directly — the frontend bundle and the functions codebase
// are deployed independently, and this list is small enough to duplicate
// rather than reach across that boundary.
const PART_TYPES = [
  'SCRN', 'LOGIC', 'HOUSASM', 'HOUS', 'BGLS', 'BATT', 'CAMR', 'CAMF',
  'CHRG', 'NFC', 'SPKR', 'EARP', 'PROX', 'FLSH', 'TAPT',
]
const GRADES = ['A', 'B', 'C', 'N']
const SOURCES = ['PULL', 'AFT', 'OEM']
const TRACKING_MODES = ['serialized', 'bulk']

function centsToDollarsString(cents) {
  return cents == null ? '' : (cents / 100).toFixed(2)
}

function dollarsStringToCents(value) {
  return Math.round(Number(value) * 100)
}

// sku: null for create, or an existing SKU doc's data for edit (identity
// fields become read-only — see updateSku's immutable-fields rule).
export default function SkuForm({ sku, onDone }) {
  const isEdit = Boolean(sku)

  const [form, setForm] = useState({
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

  function field(name) {
    return {
      value: form[name],
      onChange: (e) => setForm((f) => ({ ...f, [name]: e.target.value })),
    }
  }

  async function handleSubmit(event) {
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

      if (isEdit) {
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
      setError(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="p-6 max-w-md">
      <h2 className="text-lg font-semibold mb-4">{isEdit ? `Edit ${sku.skuCode}` : 'New SKU'}</h2>
      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <label className="flex flex-col gap-1">
          Part type
          <select {...field('partType')} disabled={isEdit} className="border rounded px-3 py-2">
            {PART_TYPES.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1">
          Model
          <input {...field('model')} disabled={isEdit} className="border rounded px-3 py-2" placeholder="IP14P" required />
        </label>

        <label className="flex flex-col gap-1">
          Grade
          <select {...field('grade')} disabled={isEdit} className="border rounded px-3 py-2">
            {GRADES.map((g) => (
              <option key={g} value={g}>
                {g}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1">
          Source
          <select {...field('source')} disabled={isEdit} className="border rounded px-3 py-2">
            {SOURCES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1">
          Tracking mode
          <select {...field('trackingMode')} disabled={isEdit} className="border rounded px-3 py-2">
            {TRACKING_MODES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>

        {isEdit && (
          <p className="text-sm text-gray-500">
            Part type, model, grade, source, and tracking mode are locked — create a new SKU to change them.
          </p>
        )}

        <label className="flex flex-col gap-1">
          Expected resale
          <input {...field('expectedResale')} type="number" step="0.01" min="0" className="border rounded px-3 py-2" required />
        </label>

        <label className="flex flex-col gap-1">
          Retail price
          <input {...field('listPriceRetail')} type="number" step="0.01" min="0" className="border rounded px-3 py-2" required />
        </label>

        <label className="flex flex-col gap-1">
          Tier 1 price (1-4 units)
          <input {...field('listPriceTier1')} type="number" step="0.01" min="0" className="border rounded px-3 py-2" required />
        </label>

        <label className="flex flex-col gap-1">
          Tier 2 price (5-19 units)
          <input {...field('listPriceTier2')} type="number" step="0.01" min="0" className="border rounded px-3 py-2" required />
        </label>

        <label className="flex flex-col gap-1">
          Tier 3 price (20+ units)
          <input {...field('listPriceTier3')} type="number" step="0.01" min="0" className="border rounded px-3 py-2" required />
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
