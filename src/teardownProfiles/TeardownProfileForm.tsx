import { useEffect, useState } from 'react'
import type { ChangeEvent, FormEvent } from 'react'
import { collection, getDocs, orderBy, query } from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { db, functions } from '../firebase'
import type { TeardownProfile, TeardownProfileGrade } from '../types'

const GRADES: readonly TeardownProfileGrade[] = ['AB', 'CD']

interface PartLine {
  key: number
  skuCode: string
  likelihood: string
}

function newPartLine(key: number, skuCode = '', likelihood = ''): PartLine {
  return { key, skuCode, likelihood }
}

// profile: null for create, or an existing profile's data for edit (model
// and donorGrade become read-only — they're baked into the doc ID, same
// convention as updateSku's immutable identity fields).
export default function TeardownProfileForm({
  profile,
  onDone,
}: {
  profile: TeardownProfile | null
  onDone: () => void
}) {
  const isEdit = Boolean(profile)

  const [model, setModel] = useState(profile?.model ?? '')
  const [donorGrade, setDonorGrade] = useState<TeardownProfileGrade>(profile?.donorGrade ?? GRADES[0])
  const [parts, setParts] = useState<PartLine[]>(() => {
    const source = profile?.expectedParts ?? []
    return source.length > 0
      ? source.map((p, i) => newPartLine(i, p.skuCode, String(p.likelihood)))
      : [newPartLine(0)]
  })
  const [nextKey, setNextKey] = useState(parts.length)

  const [existingProfiles, setExistingProfiles] = useState<TeardownProfile[]>([])
  const [copyFromId, setCopyFromId] = useState('')

  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (isEdit) return
    let cancelled = false
    async function load() {
      const snap = await getDocs(query(collection(db, 'teardownProfiles'), orderBy('profileId')))
      if (!cancelled) {
        setExistingProfiles(snap.docs.map((d) => d.data() as TeardownProfile))
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [isEdit])

  function handleCopyFrom(event: ChangeEvent<HTMLSelectElement>) {
    const sourceId = event.target.value
    setCopyFromId(sourceId)
    const source = existingProfiles.find((p) => p.profileId === sourceId)
    if (!source) return
    setDonorGrade(source.donorGrade)
    setParts(source.expectedParts.map((p, i) => newPartLine(i, p.skuCode, String(p.likelihood))))
    setNextKey(source.expectedParts.length)
  }

  function updatePart(key: number, patch: Partial<PartLine>) {
    setParts((ps) => ps.map((p) => (p.key === key ? { ...p, ...patch } : p)))
  }

  function addPart() {
    setParts((ps) => [...ps, newPartLine(nextKey)])
    setNextKey((k) => k + 1)
  }

  function removePart(key: number) {
    setParts((ps) => (ps.length > 1 ? ps.filter((p) => p.key !== key) : ps))
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setSubmitting(true)
    try {
      const expectedParts = parts.map((p) => ({
        skuCode: p.skuCode.trim(),
        likelihood: Number(p.likelihood),
      }))

      if (isEdit && profile) {
        const updateTeardownProfile = httpsCallable(functions, 'updateTeardownProfile')
        await updateTeardownProfile({ profileId: profile.profileId, expectedParts })
      } else {
        const createTeardownProfile = httpsCallable(functions, 'createTeardownProfile')
        await createTeardownProfile({ model, donorGrade, expectedParts })
      }
      onDone()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="p-4 sm:p-6 md:mx-auto md:max-w-2xl">
      <h2 className="page-title mb-4">{isEdit ? `Edit ${profile!.profileId}` : 'New teardown profile'}</h2>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        {!isEdit && existingProfiles.length > 0 && (
          <label className="field">
            Copy from existing profile (optional)
            <select value={copyFromId} onChange={handleCopyFrom} className="select">
              <option value="">— start from scratch —</option>
              {existingProfiles.map((p) => (
                <option key={p.profileId} value={p.profileId}>
                  {p.profileId} ({p.expectedParts.length} parts)
                </option>
              ))}
            </select>
          </label>
        )}

        <div className="flex flex-col gap-3 sm:grid sm:grid-cols-2">
          <label className="field">
            Model
            <input
              value={model}
              onChange={(e) => setModel(e.target.value.toUpperCase())}
              disabled={isEdit}
              className="input"
              placeholder="IP14P"
              required
            />
          </label>

          <label className="field">
            Donor grade
            <select
              value={donorGrade}
              onChange={(e) => setDonorGrade(e.target.value as TeardownProfileGrade)}
              disabled={isEdit}
              className="select"
            >
              {GRADES.map((g) => (
                <option key={g} value={g}>
                  {g}
                </option>
              ))}
            </select>
          </label>
        </div>

        {isEdit && (
          <p className="text-muted text-sm">
            Model and donor grade are locked — create a new profile to change them.
          </p>
        )}

        <div className="flex flex-col gap-3">
          <p className="section-title">Expected parts</p>
          {parts.map((part) => (
            <div key={part.key} className="card flex flex-col gap-2 p-3 sm:grid sm:grid-cols-[1fr_auto_auto] sm:items-end">
              <label className="field text-sm">
                SKU code
                <input
                  value={part.skuCode}
                  onChange={(e) => updatePart(part.key, { skuCode: e.target.value })}
                  className="input font-mono"
                  placeholder="MS-SCRN-IP14P-A-PULL"
                  required
                />
              </label>
              <label className="field text-sm">
                Likelihood
                <input
                  value={part.likelihood}
                  onChange={(e) => updatePart(part.key, { likelihood: e.target.value })}
                  type="number"
                  min="0"
                  max="1"
                  step="0.05"
                  className="input w-24"
                  required
                />
              </label>
              {parts.length > 1 && (
                <button type="button" onClick={() => removePart(part.key)} className="btn-ghost btn-sm">
                  Remove
                </button>
              )}
            </div>
          ))}
          <button type="button" onClick={addPart} className="btn-secondary text-left text-slate-700 dark:text-slate-200">
            + Add part
          </button>
        </div>

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
