import { useEffect, useState } from 'react'
import { collection, doc, getDoc, getDocs, query, Timestamp, where } from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { db, functions } from '../firebase'
import { todayWindow } from './dayWindow'
import type { Cents, DailyClose, SalesOrder } from '../types'

function formatCents(cents: Cents) {
  return `$${(cents / 100).toFixed(2)}`
}

interface CloseDayResult {
  date: string
  cashSalesTotal: Cents
  cardSalesTotal: Cents
  eTransferSalesTotal: Cents
  countedCash: Cents
  cashVariance: Cents
}

export default function DailyCloseScreen() {
  const [dayWindow] = useState(todayWindow)
  const [existing, setExisting] = useState<DailyClose | null | undefined>(undefined) // undefined = loading
  const [preview, setPreview] = useState<{ cash: Cents; card: Cents; eTransfer: Cents } | null>(null)
  const [countedCash, setCountedCash] = useState('')
  const [error, setError] = useState('')
  const [loadingPreview, setLoadingPreview] = useState(true)
  const [closing, setClosing] = useState(false)
  const [result, setResult] = useState<CloseDayResult | null>(null)

  useEffect(() => {
    let cancelled = false

    async function load() {
      const closeSnap = await getDoc(doc(db, 'dailyCloses', dayWindow.date))
      if (cancelled) return
      if (closeSnap.exists()) {
        setExisting(closeSnap.data() as DailyClose)
        setLoadingPreview(false)
        return
      }
      setExisting(null)

      // Preview only, same shape as closeDay's own query — confirmOrder
      // freezes confirmedAt once, so this is a stable, authoritative-
      // enough estimate right up until the moment of commit.
      const snap = await getDocs(
        query(
          collection(db, 'salesOrders'),
          where('confirmedAt', '>=', Timestamp.fromMillis(dayWindow.fromMs)),
          where('confirmedAt', '<', Timestamp.fromMillis(dayWindow.toMs)),
        ),
      )
      if (cancelled) return
      let cash = 0
      let card = 0
      let eTransfer = 0
      snap.docs.forEach((d) => {
        const order = d.data() as SalesOrder
        if (order.paymentMethod === 'cash') cash += order.total
        else if (order.paymentMethod === 'card') card += order.total
        else if (order.paymentMethod === 'eTransfer') eTransfer += order.total
      })
      setPreview({ cash: cash as Cents, card: card as Cents, eTransfer: eTransfer as Cents })
      setLoadingPreview(false)
    }

    load()
    return () => {
      cancelled = true
    }
  }, [dayWindow])

  async function handleClose() {
    if (!countedCash) return
    setError('')
    setClosing(true)
    try {
      const closeDay = httpsCallable<
        { date: string; fromMs: number; toMs: number; countedCash: number },
        CloseDayResult
      >(functions, 'closeDay')
      const response = await closeDay({
        date: dayWindow.date,
        fromMs: dayWindow.fromMs,
        toMs: dayWindow.toMs,
        countedCash: Math.round(Number(countedCash) * 100),
      })
      setResult(response.data)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setClosing(false)
    }
  }

  const variance = countedCash && preview ? Math.round(Number(countedCash) * 100) - preview.cash : null

  if (existing === undefined && !result) {
    return (
      <div className="p-4 sm:p-6">
        <p className="text-muted">Loading…</p>
      </div>
    )
  }

  const closed = result ?? (existing ? {
    date: existing.date,
    cashSalesTotal: existing.cashSalesTotal,
    cardSalesTotal: existing.cardSalesTotal,
    eTransferSalesTotal: existing.eTransferSalesTotal,
    countedCash: existing.countedCash,
    cashVariance: existing.cashVariance,
  } : null)

  if (closed) {
    return (
      <div className="mx-auto max-w-md p-4 sm:p-6">
        <h2 className="page-title mb-4">{closed.date} — closed</h2>
        <div className="card flex flex-col gap-3 p-4">
          <div className="flex items-center justify-between">
            <span className="text-muted text-sm">Cash sales</span>
            <span className="num-md">{formatCents(closed.cashSalesTotal)}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-muted text-sm">Card sales</span>
            <span className="num-md">{formatCents(closed.cardSalesTotal)}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-muted text-sm">e-Transfer sales</span>
            <span className="num-md">{formatCents(closed.eTransferSalesTotal)}</span>
          </div>
          <div className="flex items-center justify-between border-t border-slate-200 pt-3 dark:border-slate-800">
            <span className="text-muted text-sm">Counted cash</span>
            <span className="num-md">{formatCents(closed.countedCash)}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="section-title">Variance</span>
            <span className={closed.cashVariance !== 0 ? 'num-hero text-danger' : 'num-hero'}>
              {closed.cashVariance > 0 ? '+' : ''}
              {formatCents(closed.cashVariance)}
            </span>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-md p-4 sm:p-6">
      <h2 className="page-title mb-4">Daily close — {dayWindow.date}</h2>

      <div className="card mb-4 flex flex-col gap-3 p-4">
        <div className="flex items-center justify-between">
          <span className="text-muted text-sm">Cash sales</span>
          <span className="num-md">{loadingPreview ? '…' : formatCents(preview!.cash)}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-muted text-sm">Card sales</span>
          <span className="num-md">{loadingPreview ? '…' : formatCents(preview!.card)}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-muted text-sm">e-Transfer sales</span>
          <span className="num-md">{loadingPreview ? '…' : formatCents(preview!.eTransfer)}</span>
        </div>
      </div>

      <label className="field mb-3">
        Counted cash in drawer
        <input
          value={countedCash}
          onChange={(e) => setCountedCash(e.target.value)}
          type="number"
          step="0.01"
          min="0"
          className="input"
          disabled={loadingPreview}
        />
      </label>

      {variance != null && (
        <div className="mb-4 flex items-center justify-between">
          <span className="text-muted text-sm">Variance</span>
          <span className={variance !== 0 ? 'num-md text-danger' : 'num-md'}>
            {variance > 0 ? '+' : ''}
            {formatCents(variance as Cents)}
          </span>
        </div>
      )}

      {error && <p className="banner-danger mb-4">{error}</p>}

      <button
        onClick={() => void handleClose()}
        disabled={closing || loadingPreview || !countedCash}
        className="btn-primary btn-block"
      >
        {closing ? 'Closing…' : 'Close day'}
      </button>
    </div>
  )
}
