import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { collection, doc, getDoc, getDocs } from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { db, functions } from '../firebase'
import { getOrCreateWalkInBuyer } from './walkInBuyer'
import { findInStockItemsForSku, resolveScan } from './lookup'
import { addItemLine, addOrIncrementBulkLine, removeCartLine, updateBulkQty } from './cart'
import type { CartLine } from './cart'
import { resolveLinePrice } from './resolveLinePrice'
import { calculateTax } from './calculateTax'
import { currentTaxRateBps } from './taxRate'
import type { DatedRate } from './taxRate'
import Cart from './Cart'
import Receipt from './Receipt'
import type { ReceiptData } from './Receipt'
import { cents } from '../types'
import type { Buyer, Cents, OrderLine, PaymentMethod, Sku, StockItem, TaxConfig } from '../types'

interface CreateOrderResult {
  orderId: string
  subtotal: Cents
  tax: Cents
  taxRateBps: number
  total: Cents
  lines: OrderLine[]
}

interface ConfirmOrderResult {
  orderId: string
  status: 'confirmed'
  subtotal: Cents
  tax: Cents
  taxRateBps: number
  total: Cents
}

const PAYMENT_METHODS: { key: PaymentMethod; label: string }[] = [
  { key: 'cash', label: 'Cash' },
  { key: 'card', label: 'Card' },
  { key: 'eTransfer', label: 'e-Transfer' },
]

function formatCents(cents: Cents) {
  return `$${(cents / 100).toFixed(2)}`
}

export default function PosScreen() {
  const [walkInBuyer, setWalkInBuyer] = useState<Buyer | null>(null)
  const [buyer, setBuyer] = useState<Buyer | null>(null)
  const [buyerPickerOpen, setBuyerPickerOpen] = useState(false)
  const [allBuyers, setAllBuyers] = useState<Buyer[] | null>(null)
  const [buyerQuery, setBuyerQuery] = useState('')

  const [cart, setCart] = useState<CartLine[]>([])
  const [skuCache, setSkuCache] = useState<Record<string, Sku>>({})
  const allSkusRef = useRef<Sku[] | null>(null)

  const [scanValue, setScanValue] = useState('')
  const [scanError, setScanError] = useState('')
  const [resolving, setResolving] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<Sku[]>([])
  const [picker, setPicker] = useState<{ sku: Sku; items: StockItem[] } | null>(null)

  const [checkoutOpen, setCheckoutOpen] = useState(false)
  const [charging, setCharging] = useState(false)
  const [checkoutError, setCheckoutError] = useState('')
  const [pendingOrder, setPendingOrder] = useState<CreateOrderResult | null>(null)
  const [receipt, setReceipt] = useState<ReceiptData | null>(null)
  // Preview only, for the "Charge $X" button before checkout — confirmOrder
  // re-reads config/tax itself and freezes the authoritative rate.
  const [taxRates, setTaxRates] = useState<DatedRate[] | null>(null)

  const scanInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    let cancelled = false
    getOrCreateWalkInBuyer().then((b) => {
      if (!cancelled) {
        setWalkInBuyer(b)
        setBuyer(b)
      }
    })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    getDoc(doc(db, 'config', 'tax')).then((snap) => {
      if (cancelled || !snap.exists()) return
      const config = snap.data() as TaxConfig
      setTaxRates(config.rates.map((r) => ({ effectiveFrom: r.effectiveFrom.toDate(), rateBps: r.rateBps })))
    })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!receipt && !picker) scanInputRef.current?.focus()
  }, [receipt, picker, cart])

  function cacheSku(sku: Sku) {
    setSkuCache((c) => (c[sku.skuCode] ? c : { ...c, [sku.skuCode]: sku }))
  }

  async function lookupSku(skuCode: string): Promise<Sku> {
    if (skuCache[skuCode]) return skuCache[skuCode]
    const snap = await getDoc(doc(db, 'skus', skuCode))
    if (!snap.exists()) throw new Error(`SKU not found: ${skuCode}`)
    const sku = snap.data() as Sku
    cacheSku(sku)
    return sku
  }

  async function loadAllSkus(): Promise<Sku[]> {
    if (allSkusRef.current) return allSkusRef.current
    const snap = await getDocs(collection(db, 'skus'))
    const skus = snap.docs.map((d) => d.data() as Sku).filter((s) => s.active)
    allSkusRef.current = skus
    return skus
  }

  // Every cart edit invalidates any order already quoted against the old
  // cart contents (pendingOrder — see handleCharge's retry path) and any
  // checkout error from a previous attempt, so both are cleared here
  // rather than at each call site.
  function mutateCart(updater: (c: CartLine[]) => CartLine[]) {
    setCart(updater)
    setPendingOrder(null)
    setCheckoutError('')
  }

  async function addBulk(sku: Sku) {
    cacheSku(sku)
    const stockSnap = await getDoc(doc(db, 'bulkStock', sku.skuCode))
    const qtyOnHand = stockSnap.exists() ? (stockSnap.data().qtyOnHand as number) : 0
    mutateCart((c) => addOrIncrementBulkLine(c, sku.skuCode, sku, qtyOnHand))
  }

  async function resolveSerialized(sku: Sku) {
    cacheSku(sku)
    const items = await findInStockItemsForSku(sku.skuCode)
    if (items.length === 0) {
      setScanError(`${sku.skuCode} is out of stock.`)
      return
    }
    if (items.length === 1) {
      addItem(items[0], sku)
      return
    }
    setPicker({ sku, items })
  }

  function addItem(item: StockItem, sku: Sku) {
    cacheSku(sku)
    try {
      mutateCart((c) =>
        addItemLine(c, { kind: 'item', itemId: item.itemId, skuCode: item.skuCode, sku, grade: item.grade, qty: 1 }),
      )
      setScanError('')
    } catch (err) {
      setScanError((err as Error).message)
    }
  }

  async function handleScanSubmit(event: FormEvent) {
    event.preventDefault()
    const value = scanValue.trim()
    setScanValue('')
    if (!value) return

    setScanError('')
    setResolving(true)
    try {
      const result = await resolveScan(value)
      if (result.kind === 'item') {
        const sku = await lookupSku(result.item.skuCode)
        addItem(result.item, sku)
      } else if (result.kind === 'itemNotAvailable') {
        setScanError(`${result.item.itemId} is ${result.item.status}, not available to sell.`)
      } else if (result.kind === 'bulkSku') {
        await addBulk(result.sku)
      } else if (result.kind === 'serializedSku') {
        await resolveSerialized(result.sku)
      } else {
        setScanError(`Not found: ${value}`)
      }
    } catch (err) {
      setScanError((err as Error).message)
    } finally {
      setResolving(false)
    }
  }

  async function handleSearchChange(q: string) {
    setSearchQuery(q)
    const skus = await loadAllSkus()
    const query = q.trim().toLowerCase()
    setSearchResults(query ? skus.filter((s) => s.skuCode.toLowerCase().includes(query)).slice(0, 20) : [])
  }

  async function handleSearchPick(sku: Sku) {
    setSearchOpen(false)
    setSearchQuery('')
    setSearchResults([])
    if (sku.trackingMode === 'bulk') {
      await addBulk(sku)
    } else {
      await resolveSerialized(sku)
    }
  }

  function removeLine(index: number) {
    mutateCart((c) => removeCartLine(c, index))
  }

  function changeQty(skuCode: string, qty: number) {
    mutateCart((c) => updateBulkQty(c, skuCode, Math.max(1, qty)))
  }

  async function loadAllBuyers() {
    if (allBuyers) return
    const snap = await getDocs(collection(db, 'buyers'))
    setAllBuyers(snap.docs.map((d) => d.data() as Buyer))
  }

  // A different buyer can change every line's price (tier floor), so any
  // order already quoted against the old buyer is stale — same reasoning
  // as mutateCart above.
  function selectBuyer(b: Buyer) {
    setBuyer(b)
    setBuyerPickerOpen(false)
    setPendingOrder(null)
    setCheckoutError('')
  }

  function resetSale() {
    setCart([])
    setBuyer(walkInBuyer)
    setCheckoutOpen(false)
    setCheckoutError('')
    setPendingOrder(null)
    setReceipt(null)
  }

  async function handleCharge(paymentMethod: PaymentMethod) {
    if (!buyer) return
    setCharging(true)
    setCheckoutError('')
    try {
      // A retry after a failed confirmOrder reuses the same already-quoted
      // order instead of quoting again — createOrder only runs once per sale.
      let order = pendingOrder
      if (!order) {
        const itemIds = cart.filter((l): l is CartLine & { kind: 'item' } => l.kind === 'item').map((l) => l.itemId)
        const bulkLines = cart
          .filter((l): l is CartLine & { kind: 'bulk' } => l.kind === 'bulk')
          .map((l) => ({ skuCode: l.skuCode, qty: l.qty }))
        const createOrder = httpsCallable<
          { buyerId: string; itemIds: string[]; bulkLines: { skuCode: string; qty: number }[] },
          CreateOrderResult
        >(functions, 'createOrder')
        const created = await createOrder({ buyerId: buyer.buyerId, itemIds, bulkLines })
        order = created.data
        setPendingOrder(order)
      }

      const confirmOrder = httpsCallable<{ orderId: string; paymentMethod: PaymentMethod }, ConfirmOrderResult>(
        functions,
        'confirmOrder',
      )
      const confirmed = await confirmOrder({ orderId: order.orderId, paymentMethod })

      // The receipt shows confirmOrder's authoritative, frozen values — not
      // createOrder's pre-confirm preview — since those are the ones that
      // actually get charged and can never change afterward.
      setReceipt({
        orderId: order.orderId,
        buyerName: buyer.name,
        paymentMethod,
        lines: order.lines.map((line) => ({
          skuCode: line.skuCode,
          label: skuCache[line.skuCode]
            ? `${skuCache[line.skuCode].partType} · ${skuCache[line.skuCode].model}`
            : line.skuCode,
          qty: line.qty,
          unitPrice: line.unitPrice,
        })),
        subtotal: confirmed.data.subtotal,
        tax: confirmed.data.tax,
        taxRateBps: confirmed.data.taxRateBps,
        total: confirmed.data.total,
        confirmedAt: new Date(),
      })
      setCart([])
      setPendingOrder(null)
      setCheckoutOpen(false)
    } catch (err) {
      setCheckoutError((err as Error).message)
    } finally {
      setCharging(false)
    }
  }

  if (receipt) {
    return <Receipt receipt={receipt} onNewSale={resetSale} />
  }

  if (!buyer) {
    return (
      <div className="p-6">
        <p className="text-muted">Loading…</p>
      </div>
    )
  }

  const subtotal = cart.reduce((sum, line) => {
    const unitPrice = resolveLinePrice({ sku: line.sku, buyer, qty: line.qty })
    return sum + unitPrice * line.qty
  }, 0) as Cents

  // Preview only — same caveat as resolveLinePrice above. Falls back to $0
  // tax (subtotal-only total) if config/tax hasn't loaded yet or has no
  // rate effective yet; confirmOrder is the real authority and will throw
  // for real at checkout if config/tax genuinely isn't set up.
  let previewTax = cents(0)
  if (taxRates) {
    try {
      const rateBps = currentTaxRateBps(taxRates, new Date())
      previewTax = calculateTax({ subtotal, taxStatus: buyer.taxStatus ?? 'taxable', rateBps }).tax
    } catch {
      // no rate effective yet — leave previewTax at $0
    }
  }
  const total = cents(subtotal + previewTax)

  return (
    <div className="mx-auto max-w-2xl p-4 pb-40 sm:p-6">
      <h2 className="page-title mb-4">Sell</h2>

      {/* Buyer */}
      <div className="card mb-4 p-3">
        <div className="flex items-center justify-between gap-2">
          <div>
            <p className="eyebrow">Buyer</p>
            <p className="text-base font-semibold">{buyer.name}</p>
            <p className="text-muted text-sm">{buyer.type === 'retail' ? 'Retail pricing' : `${buyer.tier} tier`}</p>
          </div>
          <button
            type="button"
            onClick={() => {
              setBuyerPickerOpen((v) => !v)
              void loadAllBuyers()
            }}
            className="btn-secondary btn-sm"
          >
            Change buyer
          </button>
        </div>
        {buyerPickerOpen && (
          <div className="mt-3 flex flex-col gap-2">
            <input
              value={buyerQuery}
              onChange={(e) => setBuyerQuery(e.target.value)}
              placeholder="Search buyers"
              className="input min-h-9 py-1 text-sm"
            />
            <div className="flex max-h-40 flex-col gap-1 overflow-y-auto">
              {walkInBuyer && (
                <button
                  type="button"
                  onClick={() => selectBuyer(walkInBuyer)}
                  className="card active:bg-slate-100 dark:active:bg-slate-800 px-2 py-1.5 text-left text-sm"
                >
                  Walk-in (retail)
                </button>
              )}
              {(allBuyers ?? [])
                .filter((b) => b.name.toLowerCase().includes(buyerQuery.trim().toLowerCase()))
                .slice(0, 20)
                .map((b) => (
                  <button
                    type="button"
                    key={b.buyerId}
                    onClick={() => selectBuyer(b)}
                    className="card active:bg-slate-100 dark:active:bg-slate-800 px-2 py-1.5 text-left text-sm"
                  >
                    {b.name} ({b.tier})
                  </button>
                ))}
            </div>
          </div>
        )}
      </div>

      {/* Scan */}
      <form onSubmit={handleScanSubmit} className="mb-2 flex gap-2">
        <input
          ref={scanInputRef}
          value={scanValue}
          onChange={(e) => setScanValue(e.target.value)}
          placeholder="Scan a label…"
          autoFocus
          className="input"
          disabled={resolving}
        />
        <button type="submit" disabled={resolving} className="btn-primary">
          {resolving ? '…' : 'Add'}
        </button>
      </form>
      <button type="button" onClick={() => setSearchOpen((v) => !v)} className="text-muted mb-3 text-sm">
        {searchOpen ? 'Hide search' : 'Search SKUs manually'}
      </button>
      {scanError && <p className="banner-danger mb-3">{scanError}</p>}

      {searchOpen && (
        <div className="card mb-4 p-3">
          <input
            value={searchQuery}
            onChange={(e) => void handleSearchChange(e.target.value)}
            placeholder="Search by SKU code"
            autoFocus
            className="input mb-2"
          />
          <div className="flex max-h-48 flex-col gap-1 overflow-y-auto">
            {searchResults.map((sku) => (
              <button
                key={sku.skuCode}
                type="button"
                onClick={() => void handleSearchPick(sku)}
                className="card active:bg-slate-100 dark:active:bg-slate-800 px-2 py-1.5 text-left"
              >
                <div className="font-mono text-sm">{sku.skuCode}</div>
                <div className="text-muted text-xs">
                  {sku.partType} · {sku.model} · {sku.trackingMode}
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {picker && (
        <div className="card mb-4 p-3">
          <p className="mb-2 text-sm">Multiple {picker.sku.skuCode} in stock — pick one:</p>
          <div className="flex flex-col gap-1">
            {picker.items.map((item) => (
              <button
                key={item.itemId}
                type="button"
                onClick={() => {
                  addItem(item, picker.sku)
                  setPicker(null)
                }}
                className="card active:bg-slate-100 dark:active:bg-slate-800 px-2 py-1.5 text-left text-sm"
              >
                Grade {item.grade} · {item.itemId}
              </button>
            ))}
          </div>
          <button type="button" onClick={() => setPicker(null)} className="text-muted mt-2 text-sm">
            Cancel
          </button>
        </div>
      )}

      <Cart lines={cart} buyer={buyer} onRemove={removeLine} onQtyChange={changeQty} />

      {cart.length > 0 && (
        <div className="action-bar">
          <div className="mx-auto max-w-2xl">
            {checkoutError && <p className="banner-danger mb-2">{checkoutError}</p>}
            {!checkoutOpen ? (
              <button type="button" onClick={() => setCheckoutOpen(true)} className="btn-primary btn-block text-lg">
                Charge {formatCents(total)}
              </button>
            ) : (
              <div className="flex gap-2">
                {PAYMENT_METHODS.map((pm) => (
                  <button
                    key={pm.key}
                    type="button"
                    disabled={charging}
                    onClick={() => void handleCharge(pm.key)}
                    className="btn-primary flex-1"
                  >
                    {pm.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
