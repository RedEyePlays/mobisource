import { useState } from 'react'
import type { FormEvent } from 'react'
import { collection, doc, getDoc, getDocs } from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { db, functions } from '../firebase'
import { supplierSkuMapId } from './supplierSkuMapId'
import { printBulkLabels } from '../printing/printClient'
import type { PurchaseCurrency, Sku, SupplierSkuMap } from '../types'

const CURRENCIES: readonly PurchaseCurrency[] = ['CAD', 'USD']

function dollarsToCents(value: string): number {
  return Math.round(Number(value) * 100)
}

interface LineState {
  key: number
  supplierSku: string
  skuCode: string
  resolution: 'unresolved' | 'resolved' | 'not-found'
  skuPickerQuery: string
  qty: string
  unitCostUSD: string
  oversized: boolean
  overrideCurrency: PurchaseCurrency
  overrideAmount: string
}

function newLine(key: number): LineState {
  return {
    key,
    supplierSku: '',
    skuCode: '',
    resolution: 'unresolved',
    skuPickerQuery: '',
    qty: '',
    unitCostUSD: '',
    oversized: false,
    overrideCurrency: 'CAD',
    overrideAmount: '',
  }
}

export default function BulkReceiveForm({ onDone }: { onDone: () => void }) {
  const [supplier, setSupplier] = useState('')
  const [invoiceRef, setInvoiceRef] = useState('')
  const [fxRate, setFxRate] = useState('')
  const [shippingKnown, setShippingKnown] = useState(true)
  const [shippingCurrency, setShippingCurrency] = useState<PurchaseCurrency>('CAD')
  const [shippingTotal, setShippingTotal] = useState('')
  const [hstPaid, setHstPaid] = useState('')
  const [lines, setLines] = useState<LineState[]>([newLine(0)])
  const [nextKey, setNextKey] = useState(1)
  const [activeSkus, setActiveSkus] = useState<Sku[] | null>(null)
  const [error, setError] = useState('')
  const [printWarning, setPrintWarning] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function loadActiveSkus() {
    if (activeSkus) return activeSkus
    const snap = await getDocs(collection(db, 'skus'))
    const skus = snap.docs.map((d) => d.data() as Sku).filter((s) => s.active)
    setActiveSkus(skus)
    return skus
  }

  function updateLine(key: number, patch: Partial<LineState>) {
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)))
  }

  async function resolveSupplierSku(line: LineState) {
    if (!supplier.trim() || !line.supplierSku.trim()) return
    try {
      const mapId = supplierSkuMapId(supplier, line.supplierSku)
      const snap = await getDoc(doc(db, 'supplierSkuMap', mapId))
      if (snap.exists()) {
        const mapping = snap.data() as SupplierSkuMap
        updateLine(line.key, { skuCode: mapping.skuCode, resolution: 'resolved' })
      } else {
        await loadActiveSkus()
        updateLine(line.key, { skuCode: '', resolution: 'not-found' })
      }
    } catch {
      updateLine(line.key, { skuCode: '', resolution: 'not-found' })
    }
  }

  function addLine() {
    setLines((ls) => [...ls, newLine(nextKey)])
    setNextKey((k) => k + 1)
  }

  function removeLine(key: number) {
    setLines((ls) => (ls.length > 1 ? ls.filter((l) => l.key !== key) : ls))
  }

  // Prints a batch of N bulk-part labels per line (N = the qty just
  // received) — same barcode on every unit, per docs/SCHEMA.md §2. Runs
  // after the receipt is already committed, so a print failure here never
  // blocks or reverses the receiving transaction.
  async function printLabelsFor(receivedLines: LineState[]): Promise<number> {
    const skus = await loadActiveSkus()
    const skuByCode = new Map(skus.map((s) => [s.skuCode, s]))
    const outcomes = await Promise.allSettled(
      receivedLines.map((line) => {
        const sku = skuByCode.get(line.skuCode)
        if (!sku) return Promise.reject(new Error(`SKU ${line.skuCode} not found for printing.`))
        return printBulkLabels(
          { skuCode: sku.skuCode, model: sku.model, grade: sku.grade, partType: sku.partType },
          Number(line.qty),
        )
      }),
    )
    return outcomes.filter((o) => o.status === 'rejected').length
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setPrintWarning('')

    const unresolved = lines.find((l) => !l.skuCode)
    if (unresolved) {
      setError(`Map a SKU for supplier code "${unresolved.supplierSku}" before submitting.`)
      return
    }

    setSubmitting(true)
    try {
      const receiveBulkShipment = httpsCallable(functions, 'receiveBulkShipment')
      await receiveBulkShipment({
        supplier,
        invoiceRef,
        fxRate: Number(fxRate),
        shipping: shippingKnown
          ? { currency: shippingCurrency, total: dollarsToCents(shippingTotal) }
          : null,
        hstPaidCAD: hstPaid ? dollarsToCents(hstPaid) : 0,
        lines: lines.map((l) => ({
          supplierSku: l.supplierSku,
          skuCode: l.skuCode,
          qty: Number(l.qty),
          unitCostUSD: dollarsToCents(l.unitCostUSD),
          shippingOverride: l.oversized
            ? { currency: l.overrideCurrency, amount: dollarsToCents(l.overrideAmount) }
            : null,
        })),
      })

      const failedCount = await printLabelsFor(lines)
      if (failedCount > 0) {
        setPrintWarning(
          `Shipment received. Labels for ${failedCount} of ${lines.length} line${lines.length === 1 ? '' : 's'} didn't print — check the print service is running, then reprint from the SKU catalog.`,
        )
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
    <div className="mx-auto max-w-2xl p-4 sm:p-6">
      <h2 className="page-title mb-4">Receive a shipment</h2>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div className="flex flex-col gap-3 md:grid md:grid-cols-3">
          <label className="field">
            Supplier
            <input value={supplier} onChange={(e) => setSupplier(e.target.value)} className="input" required />
          </label>
          <label className="field">
            Invoice ref
            <input value={invoiceRef} onChange={(e) => setInvoiceRef(e.target.value)} className="input" required />
          </label>
          <label className="field">
            FX rate (USD→CAD)
            <input
              value={fxRate}
              onChange={(e) => setFxRate(e.target.value)}
              type="number"
              step="0.0001"
              min="0"
              className="input"
              required
            />
          </label>
        </div>

        <div className="card p-3">
          <p className="section-title mb-2">Shipping</p>
          <div className="mb-2 flex flex-col gap-2 sm:flex-row sm:gap-4">
            <label className="flex items-center gap-2">
              <input type="radio" checked={shippingKnown} onChange={() => setShippingKnown(true)} className="checkbox" />
              Known now
            </label>
            <label className="flex items-center gap-2">
              <input type="radio" checked={!shippingKnown} onChange={() => setShippingKnown(false)} className="checkbox" />
              Pending — apply it later
            </label>
          </div>
          {shippingKnown && (
            <div className="flex flex-col gap-2 sm:flex-row sm:gap-3">
              <select
                value={shippingCurrency}
                onChange={(e) => setShippingCurrency(e.target.value as PurchaseCurrency)}
                className="select sm:w-auto"
              >
                {CURRENCIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
              <input
                value={shippingTotal}
                onChange={(e) => setShippingTotal(e.target.value)}
                type="number"
                step="0.01"
                min="0"
                placeholder="Total shipping"
                className="input flex-1"
                required
              />
            </div>
          )}
        </div>

        <label className="field">
          HST paid on this shipment (CAD, if any)
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

        <div className="flex flex-col gap-3">
          <p className="section-title">Lines</p>
          {lines.map((line) => (
            <div key={line.key} className="card p-3">
              <div className="flex flex-col gap-2 sm:grid sm:grid-cols-4">
                <label className="field text-sm">
                  Supplier SKU
                  <input
                    value={line.supplierSku}
                    onChange={(e) => updateLine(line.key, { supplierSku: e.target.value, resolution: 'unresolved' })}
                    onBlur={() => resolveSupplierSku(line)}
                    className="input"
                    required
                  />
                </label>
                <label className="field text-sm">
                  Qty
                  <input
                    value={line.qty}
                    onChange={(e) => updateLine(line.key, { qty: e.target.value })}
                    type="number"
                    min="1"
                    step="1"
                    className="input"
                    required
                  />
                </label>
                <label className="field text-sm">
                  Unit cost (USD)
                  <input
                    value={line.unitCostUSD}
                    onChange={(e) => updateLine(line.key, { unitCostUSD: e.target.value })}
                    type="number"
                    min="0"
                    step="0.01"
                    className="input"
                    required
                  />
                </label>
                <div className="flex items-end">
                  {lines.length > 1 && (
                    <button type="button" onClick={() => removeLine(line.key)} className="btn-ghost btn-sm">
                      Remove line
                    </button>
                  )}
                </div>
              </div>

              {line.resolution === 'resolved' && (
                <p className="mt-2 font-mono text-sm text-emerald-700 dark:text-emerald-400">Resolved: {line.skuCode}</p>
              )}
              {line.resolution === 'not-found' && (
                <div className="mt-2">
                  <p className="mb-1 text-sm text-amber-700 dark:text-amber-400">
                    No mapping for this supplier code yet — pick the SKU it maps to:
                  </p>
                  <input
                    value={line.skuPickerQuery}
                    onChange={(e) => updateLine(line.key, { skuPickerQuery: e.target.value })}
                    placeholder="Search SKUs"
                    className="input mb-1 min-h-9 py-1 text-sm"
                  />
                  <div className="flex max-h-40 flex-col gap-1 overflow-y-auto">
                    {(activeSkus ?? [])
                      .filter((s) =>
                        s.skuCode.toLowerCase().includes(line.skuPickerQuery.trim().toLowerCase()),
                      )
                      .slice(0, 20)
                      .map((s) => (
                        <button
                          type="button"
                          key={s.skuCode}
                          onClick={() => updateLine(line.key, { skuCode: s.skuCode, resolution: 'resolved' })}
                          className="card active:bg-slate-100 dark:active:bg-slate-800 px-2 py-1.5 text-left font-mono text-sm"
                        >
                          {s.skuCode}
                        </button>
                      ))}
                  </div>
                </div>
              )}

              <label className="mt-2 flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={line.oversized}
                  onChange={(e) => updateLine(line.key, { oversized: e.target.checked })}
                  className="checkbox"
                />
                Oversized — flat per-unit shipping override
              </label>
              {line.oversized && (
                <div className="mt-1 flex gap-2">
                  <select
                    value={line.overrideCurrency}
                    onChange={(e) => updateLine(line.key, { overrideCurrency: e.target.value as PurchaseCurrency })}
                    className="select w-auto min-h-9 py-1 text-sm"
                  >
                    {CURRENCIES.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                  <input
                    value={line.overrideAmount}
                    onChange={(e) => updateLine(line.key, { overrideAmount: e.target.value })}
                    type="number"
                    min="0"
                    step="0.01"
                    placeholder="Per-unit shipping"
                    className="input min-h-9 flex-1 py-1 text-sm"
                    required={line.oversized}
                  />
                </div>
              )}
            </div>
          ))}
          <button type="button" onClick={addLine} className="btn-secondary text-left text-slate-700 dark:text-slate-200">
            + Add line
          </button>
        </div>

        {error && <p className="banner-danger">{error}</p>}

        {printWarning && (
          <div className="banner-warning flex flex-col gap-2">
            <p>{printWarning}</p>
            <button type="button" onClick={onDone} className="btn-secondary btn-sm self-start">
              Continue
            </button>
          </div>
        )}

        {!printWarning && (
          <div className="flex flex-col gap-2 sm:flex-row">
            <button type="submit" disabled={submitting} className="btn-primary">
              {submitting ? 'Receiving…' : 'Receive shipment'}
            </button>
            <button type="button" onClick={onDone} className="btn-secondary">
              Cancel
            </button>
          </div>
        )}
      </form>
    </div>
  )
}
