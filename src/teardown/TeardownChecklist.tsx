import { useEffect, useMemo, useState } from 'react'
import { collection, doc, getDoc, getDocs } from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { db, functions } from '../firebase'
import { allocateDonorCost, mapDonorGradeToProfileGrade } from './allocation'
import { printHarvestedLabel } from '../printing/printClient'
import PartRow from './PartRow'
import type { PartOutcome } from './PartRow'
import type { Cents, Donor, Sku, StockItem, TeardownProfile } from '../types'

function formatCents(cents: Cents) {
  return `$${(cents / 100).toFixed(2)}`
}

interface RowState {
  outcome: PartOutcome
  reason: string
  isExtra: boolean
}

interface PerformTeardownResult {
  teardownId: string
  itemsCreated: string[]
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
  const [printWarning, setPrintWarning] = useState('')
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

  // Prints one harvested-part label per stockItem the teardown created —
  // sellable and scrapped both get a physical stockItem doc (SCHEMA.md §6),
  // so both get a label. Fetches each created item back from Firestore
  // rather than trusting the client's own submission order to line up with
  // the server's itemsCreated array, since a label on the wrong physical
  // part is a real mistake even though it isn't money math.
  async function printLabelsFor(itemIds: string[]): Promise<number> {
    const snaps = await Promise.all(itemIds.map((id) => getDoc(doc(db, 'stockItems', id))))
    const outcomes = await Promise.allSettled(
      snaps
        .filter((snap) => snap.exists())
        .map((snap) => {
          const item = snap.data() as StockItem
          return printHarvestedLabel({ itemId: item.itemId, skuCode: item.skuCode, grade: item.grade, model: donor.model })
        }),
    )
    return outcomes.filter((o) => o.status === 'rejected').length
  }

  async function handleConfirm() {
    setSubmitError('')
    setPrintWarning('')
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

      const performTeardown = httpsCallable<{ donorId: string; parts: unknown }, PerformTeardownResult>(
        functions,
        'performTeardown',
      )
      const result = await performTeardown({ donorId: donor.id, parts })

      const failedCount = await printLabelsFor(result.data.itemsCreated)
      if (failedCount > 0) {
        const total = result.data.itemsCreated.length
        setPrintWarning(
          `Teardown saved. ${failedCount} of ${total} label${total === 1 ? '' : 's'} didn't print — check the print service is running, then reprint from the Inventory list.`,
        )
      } else {
        onDone()
      }
    } catch (err) {
      setSubmitError((err as Error).message)
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) {
    return (
      <div className="mx-auto max-w-lg p-4">
        <p className="text-lg">Loading teardown profile…</p>
      </div>
    )
  }

  if (loadError || !profile) {
    return (
      <div className="mx-auto max-w-lg p-4">
        <p className="text-danger mb-4 text-lg">{loadError}</p>
        <button onClick={onBack} className="btn-secondary btn-block py-4 text-lg">
          Back to search
        </button>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-lg p-4 pb-32">
      <button onClick={onBack} className="text-muted mb-2">
        ← Back to search
      </button>
      <h2 className="page-title text-2xl">{donor.model}</h2>
      <p className="text-muted mb-4">
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
          <button onClick={() => setShowAddPart(true)} className="btn-secondary btn-block text-slate-700 dark:text-slate-200">
            + Add a part not on this list
          </button>
        ) : (
          <div className="card p-4">
            <input
              type="text"
              value={addPartQuery}
              onChange={(e) => setAddPartQuery(e.target.value)}
              placeholder="Search SKUs for this model"
              autoFocus
              className="input mb-3"
            />
            {addablePartsSkus.length === 0 ? (
              <p className="text-muted">No matching active SKUs to add.</p>
            ) : (
              <div className="flex max-h-64 flex-col gap-2 overflow-y-auto">
                {addablePartsSkus.map((sku) => (
                  <button
                    key={sku.skuCode}
                    onClick={() => addPart(sku)}
                    className="card active:bg-slate-100 dark:active:bg-slate-800 px-3 py-3 text-left"
                  >
                    <div className="font-medium">{sku.partType}</div>
                    <div className="text-muted font-mono text-sm">{sku.skuCode}</div>
                  </button>
                ))}
              </div>
            )}
            <button onClick={() => setShowAddPart(false)} className="text-muted mt-3">
              Done adding parts
            </button>
          </div>
        )}
      </div>

      {preview.error && harvestedSkuCodes.length > 0 && (
        <p className="text-danger mt-4">{preview.error}</p>
      )}

      {preview.allocations && (
        <div className="mt-6 border-t border-slate-200 pt-4 dark:border-slate-800">
          <p className="num-lg">
            Total allocated: {formatCents(donor.purchaseCost)} across {preview.allocations.length}{' '}
            {preview.allocations.length === 1 ? 'part' : 'parts'}
          </p>
        </div>
      )}

      {submitError && <p className="text-danger mt-4">{submitError}</p>}

      {printWarning && (
        <div className="banner-warning mt-4 flex flex-col gap-2">
          <p>{printWarning}</p>
          <button onClick={onDone} className="btn-secondary btn-sm self-start">
            Continue
          </button>
        </div>
      )}

      {!printWarning && (
        <div className="action-bar">
          <div className="mx-auto max-w-lg">
            <button onClick={handleConfirm} disabled={!canConfirm} className="btn-primary btn-block text-lg">
              {submitting ? 'Confirming…' : 'Confirm teardown'}
            </button>
            {harvestedSkuCodes.length === 0 && (
              <p className="text-muted mt-2 text-center text-sm">Mark at least one part harvested to continue.</p>
            )}
            {scrappedMissingReason && (
              <p className="text-danger mt-2 text-center text-sm">Every scrapped part needs a reason.</p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
