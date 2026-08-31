import { useState } from 'react'
import type { FormEvent } from 'react'
import { collection, doc, getDoc, getDocs } from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { db, functions } from '../firebase'
import { supplierSkuMapId } from './supplierSkuMapId'
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
  const [lines, setLines] = useState<LineState[]>([newLine(0)])
  const [nextKey, setNextKey] = useState(1)
  const [activeSkus, setActiveSkus] = useState<Sku[] | null>(null)
  const [error, setError] = useState('')
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

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')

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
      onDone()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="p-6 max-w-2xl">
      <h2 className="text-lg font-semibold mb-4">Receive a shipment</h2>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div className="grid grid-cols-3 gap-3">
          <label className="flex flex-col gap-1">
            Supplier
            <input
              value={supplier}
              onChange={(e) => setSupplier(e.target.value)}
              className="border rounded px-3 py-2"
              required
            />
          </label>
          <label className="flex flex-col gap-1">
            Invoice ref
            <input
              value={invoiceRef}
              onChange={(e) => setInvoiceRef(e.target.value)}
              className="border rounded px-3 py-2"
              required
            />
          </label>
          <label className="flex flex-col gap-1">
            FX rate (USD→CAD)
            <input
              value={fxRate}
              onChange={(e) => setFxRate(e.target.value)}
              type="number"
              step="0.0001"
              min="0"
              className="border rounded px-3 py-2"
              required
            />
          </label>
        </div>

        <div className="border rounded p-3">
          <p className="font-medium mb-2">Shipping</p>
          <div className="flex gap-4 mb-2">
            <label className="flex items-center gap-2">
              <input type="radio" checked={shippingKnown} onChange={() => setShippingKnown(true)} />
              Known now
            </label>
            <label className="flex items-center gap-2">
              <input type="radio" checked={!shippingKnown} onChange={() => setShippingKnown(false)} />
              Pending — apply it later
            </label>
          </div>
          {shippingKnown && (
            <div className="flex gap-3">
              <select
                value={shippingCurrency}
                onChange={(e) => setShippingCurrency(e.target.value as PurchaseCurrency)}
                className="border rounded px-3 py-2"
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
                className="border rounded px-3 py-2 flex-1"
                required
              />
            </div>
          )}
        </div>

        <div className="flex flex-col gap-3">
          <p className="font-medium">Lines</p>
          {lines.map((line) => (
            <div key={line.key} className="border rounded p-3">
              <div className="grid grid-cols-4 gap-2 mb-2">
                <label className="flex flex-col gap-1 text-sm">
                  Supplier SKU
                  <input
                    value={line.supplierSku}
                    onChange={(e) => updateLine(line.key, { supplierSku: e.target.value, resolution: 'unresolved' })}
                    onBlur={() => resolveSupplierSku(line)}
                    className="border rounded px-2 py-1"
                    required
                  />
                </label>
                <label className="flex flex-col gap-1 text-sm">
                  Qty
                  <input
                    value={line.qty}
                    onChange={(e) => updateLine(line.key, { qty: e.target.value })}
                    type="number"
                    min="1"
                    step="1"
                    className="border rounded px-2 py-1"
                    required
                  />
                </label>
                <label className="flex flex-col gap-1 text-sm">
                  Unit cost (USD)
                  <input
                    value={line.unitCostUSD}
                    onChange={(e) => updateLine(line.key, { unitCostUSD: e.target.value })}
                    type="number"
                    min="0"
                    step="0.01"
                    className="border rounded px-2 py-1"
                    required
                  />
                </label>
                <div className="flex items-end">
                  {lines.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removeLine(line.key)}
                      className="text-gray-500 text-sm px-2 py-1"
                    >
                      Remove line
                    </button>
                  )}
                </div>
              </div>

              {line.resolution === 'resolved' && (
                <p className="text-sm text-green-700 font-mono">Resolved: {line.skuCode}</p>
              )}
              {line.resolution === 'not-found' && (
                <div className="mt-2">
                  <p className="text-sm text-yellow-700 mb-1">
                    No mapping for this supplier code yet — pick the SKU it maps to:
                  </p>
                  <input
                    value={line.skuPickerQuery}
                    onChange={(e) => updateLine(line.key, { skuPickerQuery: e.target.value })}
                    placeholder="Search SKUs"
                    className="border rounded px-2 py-1 text-sm w-full mb-1"
                  />
                  <div className="flex flex-col gap-1 max-h-40 overflow-y-auto">
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
                          className="text-left border rounded px-2 py-1 text-sm font-mono active:bg-gray-100"
                        >
                          {s.skuCode}
                        </button>
                      ))}
                  </div>
                </div>
              )}

              <label className="flex items-center gap-2 text-sm mt-2">
                <input
                  type="checkbox"
                  checked={line.oversized}
                  onChange={(e) => updateLine(line.key, { oversized: e.target.checked })}
                />
                Oversized — flat per-unit shipping override
              </label>
              {line.oversized && (
                <div className="flex gap-2 mt-1">
                  <select
                    value={line.overrideCurrency}
                    onChange={(e) => updateLine(line.key, { overrideCurrency: e.target.value as PurchaseCurrency })}
                    className="border rounded px-2 py-1 text-sm"
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
                    className="border rounded px-2 py-1 text-sm flex-1"
                    required={line.oversized}
                  />
                </div>
              )}
            </div>
          ))}
          <button type="button" onClick={addLine} className="border rounded px-3 py-2 text-left text-gray-700">
            + Add line
          </button>
        </div>

        {error && <p className="text-red-600 text-sm">{error}</p>}

        <div className="flex gap-2">
          <button
            type="submit"
            disabled={submitting}
            className="bg-black text-white rounded px-3 py-2 disabled:opacity-50"
          >
            Receive shipment
          </button>
          <button type="button" onClick={onDone} className="border rounded px-3 py-2">
            Cancel
          </button>
        </div>
      </form>
    </div>
  )
}
