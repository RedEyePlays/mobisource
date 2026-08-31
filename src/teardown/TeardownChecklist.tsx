import { useEffect, useMemo, useState } from 'react'
import { collection, doc, getDoc, getDocs } from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { db, functions } from '../firebase'
import { allocateDonorCost, mapDonorGradeToProfileGrade } from './allocation'
import PartRow from './PartRow'
import type { PartOutcome } from './PartRow'
import type { Cents, Donor, Sku, TeardownProfile } from '../types'

function formatCents(cents: Cents) {
  return `$${(cents / 100).toFixed(2)}`
}

interface RowState {
  outcome: PartOutcome
  reason: string
  isExtra: boolean
}

export default function TeardownChecklist({
  donor,
  onDone,
  onBack,
}: {
  donor: Donor
  onDone: () => void
  onBack: () => void
}) {
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [profile, setProfile] = useState<TeardownProfile | null>(null)
  const [skus, setSkus] = useState<Sku[]>([])
  const [rowOrder, setRowOrder] = useState<string[]>([])
  const [rows, setRows] = useState<Record<string, RowState>>({})
  const [showAddPart, setShowAddPart] = useState(false)
  const [addPartQuery, setAddPartQuery] = useState('')
  const [submitError, setSubmitError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    let cancelled = false

    async function load() {
      setLoading(true)
      setLoadError('')
      try {
        const profileId = `${donor.model}-${mapDonorGradeToProfileGrade(donor.condition)}`
        const [profileSnap, skusSnap] = await Promise.all([
          getDoc(doc(db, 'teardownProfiles', profileId)),
          getDocs(collection(db, 'skus')),
        ])
        if (cancelled) return

        if (!profileSnap.exists()) {
          setLoadError(`No teardown profile found for ${profileId}.`)
          setLoading(false)
          return
        }

        const loadedProfile = profileSnap.data() as TeardownProfile
        const loadedSkus = skusSnap.docs.map((d) => d.data() as Sku)

        setProfile(loadedProfile)
        setSkus(loadedSkus)
        setRowOrder(loadedProfile.expectedParts.map((p) => p.skuCode))
        setRows(
          Object.fromEntries(
            loadedProfile.expectedParts.map((p) => [p.skuCode, { outcome: 'notHarvested', reason: '', isExtra: false }]),
          ),
        )
        setLoading(false)
      } catch (err) {
        if (!cancelled) {
          setLoadError((err as Error).message)
          setLoading(false)
        }
      }
    }

    load()
    return () => {
      cancelled = true
    }
  }, [donor.id, donor.model, donor.condition])

  const skuByCode = useMemo(() => new Map(skus.map((s) => [s.skuCode, s])), [skus])

  const addablePartsSkus = useMemo(() => {
    const q = addPartQuery.trim().toLowerCase()
    return skus.filter((s) => {
      if (s.model !== donor.model || !s.active) return false
      if (rowOrder.includes(s.skuCode)) return false
      if (!q) return true
      return s.skuCode.toLowerCase().includes(q) || s.partType.toLowerCase().includes(q)
    })
  }, [skus, donor.model, rowOrder, addPartQuery])

  function setOutcome(skuCode: string, outcome: PartOutcome) {
    setRows((r) => ({ ...r, [skuCode]: { ...r[skuCode], outcome } }))
  }

  function setReason(skuCode: string, reason: string) {
    setRows((r) => ({ ...r, [skuCode]: { ...r[skuCode], reason } }))
  }

  function addPart(sku: Sku) {
    setRowOrder((order) => [...order, sku.skuCode])
    setRows((r) => ({ ...r, [sku.skuCode]: { outcome: 'harvested', reason: '', isExtra: true } }))
    setAddPartQuery('')
  }

  function removePart(skuCode: string) {
    setRowOrder((order) => order.filter((code) => code !== skuCode))
    setRows((r) => {
      const next = { ...r }
      delete next[skuCode]
      return next
    })
  }

  const harvestedSkuCodes = rowOrder.filter((code) => rows[code]?.outcome === 'harvested')
  const scrappedMissingReason = rowOrder.some(
    (code) => rows[code]?.outcome === 'scrapped' && !rows[code].reason.trim(),
  )

  const preview = useMemo(() => {
    if (harvestedSkuCodes.length === 0) return { allocations: null, error: '' }
    try {
      const allocations = allocateDonorCost(
        donor.purchaseCost,
        harvestedSkuCodes.map((skuCode) => ({
          skuCode,
          expectedResaleCents: skuByCode.get(skuCode)!.expectedResale,
        })),
      )
      return { allocations, error: '' }
    } catch (err) {
      return { allocations: null, error: (err as Error).message }
    }
  }, [harvestedSkuCodes, donor.purchaseCost, skuByCode])

  const allocatedBySkuCode = useMemo(
    () => new Map((preview.allocations ?? []).map((a) => [a.skuCode, a.allocatedCostCents])),
    [preview.allocations],
  )

  const canConfirm =
    !submitting && harvestedSkuCodes.length > 0 && !scrappedMissingReason && preview.allocations != null

  async function handleConfirm() {
    setSubmitError('')
    setSubmitting(true)
    try {
      const parts = rowOrder
        .filter((code) => rows[code].outcome !== 'notHarvested')
        .map((code) => {
          const row = rows[code]
          return {
            skuCode: code,
            outcome: row.outcome === 'harvested' ? 'sellable' : 'scrapped',
            ...(row.outcome === 'scrapped' ? { reason: row.reason } : {}),
          }
        })

      const performTeardown = httpsCallable(functions, 'performTeardown')
      await performTeardown({ donorId: donor.id, parts })
      onDone()
    } catch (err) {
      setSubmitError((err as Error).message)
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) {
    return (
      <div className="p-4 max-w-lg mx-auto">
        <p className="text-lg">Loading teardown profile…</p>
      </div>
    )
  }

  if (loadError || !profile) {
    return (
      <div className="p-4 max-w-lg mx-auto">
        <p className="text-red-600 text-lg mb-4">{loadError}</p>
        <button onClick={onBack} className="w-full border rounded-lg py-4 text-lg">
          Back to search
        </button>
      </div>
    )
  }

  return (
    <div className="p-4 max-w-lg mx-auto pb-32">
      <button onClick={onBack} className="text-gray-500 mb-2">
        ← Back to search
      </button>
      <h2 className="text-xl font-semibold">{donor.model}</h2>
      <p className="text-gray-600 mb-4">
        {donor.imei || `IMEI blank — ${donor.imeiBlankReason}`} · Condition {donor.condition} ·{' '}
        {formatCents(donor.purchaseCost)}
      </p>

      <div className="flex flex-col gap-3">
        {rowOrder.map((skuCode) => {
          const sku = skuByCode.get(skuCode)
          const row = rows[skuCode]
          if (!sku || !row) return null
          return (
            <PartRow
              key={skuCode}
              skuCode={skuCode}
              label={sku.partType}
              outcome={row.outcome}
              reason={row.reason}
              allocatedPreview={allocatedBySkuCode.get(skuCode) ?? null}
              onOutcomeChange={(outcome) => setOutcome(skuCode, outcome)}
              onReasonChange={(reason) => setReason(skuCode, reason)}
              onRemove={row.isExtra ? () => removePart(skuCode) : undefined}
            />
          )
        })}
      </div>

      <div className="mt-4">
        {!showAddPart ? (
          <button
            onClick={() => setShowAddPart(true)}
            className="w-full border rounded-lg py-4 text-lg text-gray-700"
          >
            + Add a part not on this list
          </button>
        ) : (
          <div className="border rounded-lg p-4">
            <input
              type="text"
              value={addPartQuery}
              onChange={(e) => setAddPartQuery(e.target.value)}
              placeholder="Search SKUs for this model"
              autoFocus
              className="w-full border rounded-lg px-3 py-3 text-base mb-3"
            />
            {addablePartsSkus.length === 0 ? (
              <p className="text-gray-500">No matching active SKUs to add.</p>
            ) : (
              <div className="flex flex-col gap-2 max-h-64 overflow-y-auto">
                {addablePartsSkus.map((sku) => (
                  <button
                    key={sku.skuCode}
                    onClick={() => addPart(sku)}
                    className="text-left border rounded-lg px-3 py-3 active:bg-gray-100"
                  >
                    <div className="font-medium">{sku.partType}</div>
                    <div className="text-sm text-gray-500 font-mono">{sku.skuCode}</div>
                  </button>
                ))}
              </div>
            )}
            <button onClick={() => setShowAddPart(false)} className="mt-3 text-gray-500">
              Done adding parts
            </button>
          </div>
        )}
      </div>

      {preview.error && harvestedSkuCodes.length > 0 && (
        <p className="text-red-600 mt-4">{preview.error}</p>
      )}

      {preview.allocations && (
        <div className="mt-6 border-t pt-4">
          <p className="text-lg font-semibold">
            Total allocated: {formatCents(donor.purchaseCost)} across {preview.allocations.length}{' '}
            {preview.allocations.length === 1 ? 'part' : 'parts'}
          </p>
        </div>
      )}

      {submitError && <p className="text-red-600 mt-4">{submitError}</p>}

      <div className="fixed bottom-0 left-0 right-0 bg-white border-t p-4">
        <div className="max-w-lg mx-auto">
          <button
            onClick={handleConfirm}
            disabled={!canConfirm}
            className="w-full bg-black text-white rounded-lg py-4 text-lg font-semibold disabled:opacity-40"
          >
            {submitting ? 'Confirming…' : 'Confirm teardown'}
          </button>
          {harvestedSkuCodes.length === 0 && (
            <p className="text-gray-500 text-sm mt-2 text-center">Mark at least one part harvested to continue.</p>
          )}
          {scrappedMissingReason && (
            <p className="text-red-600 text-sm mt-2 text-center">Every scrapped part needs a reason.</p>
          )}
        </div>
      </div>
    </div>
  )
}
