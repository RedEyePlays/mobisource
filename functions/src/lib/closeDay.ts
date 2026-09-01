import type { Firestore, WithFieldValue } from 'firebase-admin/firestore'
import { FieldValue, Timestamp } from 'firebase-admin/firestore'
import { cents } from './types.js'
import type { DailyClose, SalesOrder } from './types.js'

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const MIN_WINDOW_MS = 60 * 60 * 1000 // 1 hour
const MAX_WINDOW_MS = 30 * 60 * 60 * 1000 // 30 hours — a generous margin over a 25h DST fall-back day

export interface CloseDayInput {
  /** 'YYYY-MM-DD' — becomes the doc ID, which is what makes a day locked: closing the same date twice is rejected. */
  date?: unknown
  /** The [fromMs, toMs) window to sum, as epoch ms — the caller's own local midnight-to-midnight. See the note below on why this isn't computed here. */
  fromMs?: unknown
  toMs?: unknown
  countedCash?: unknown
}

export interface CloseDayResult {
  date: string
  cashSalesTotal: DailyClose['cashSalesTotal']
  cardSalesTotal: DailyClose['cardSalesTotal']
  eTransferSalesTotal: DailyClose['eTransferSalesTotal']
  countedCash: DailyClose['countedCash']
  cashVariance: DailyClose['cashVariance']
}

/**
 * Closes out one counter day: sums that day's realized cash/card/eTransfer
 * sales (by paymentMethod on every order with a confirmedAt in the window
 * — every such order is realized for good, since confirmOrder sets it once
 * and neither a return nor anything else ever moves an order back off a
 * realized status) and records the counted-cash variance.
 *
 * Locked once closed: the doc ID is `date`, so a second close for the same
 * day is rejected rather than silently overwriting a past day's record.
 *
 * Decision made without asking: the day's [fromMs, toMs) window is supplied
 * by the caller (the browser, computed from its own local midnight-to-
 * midnight via plain `Date` arithmetic) rather than derived here from
 * `date` alone. A Cloud Function runs in UTC by default, and naive UTC day
 * boundaries would misattribute an evening sale (Eastern time) to the
 * wrong calendar day — there's no dependency-free way to compute IANA-
 * timezone-aware boundaries server-side, so the browser's own notion of
 * "today" is trusted for the window, while the sums themselves are still
 * computed authoritatively here, straight off salesOrders. The window is
 * only sanity-checked (a plausible ~one-day span), not re-derived.
 */
export async function closeDay(db: Firestore, input: CloseDayInput): Promise<CloseDayResult> {
  if (typeof input.date !== 'string' || !DATE_RE.test(input.date)) {
    throw new Error('date must be in YYYY-MM-DD form.')
  }
  if (!Number.isInteger(input.fromMs) || !Number.isInteger(input.toMs)) {
    throw new Error('fromMs and toMs must be integers (epoch milliseconds).')
  }
  const fromMs = input.fromMs as number
  const toMs = input.toMs as number
  if (toMs <= fromMs) {
    throw new Error('toMs must be after fromMs.')
  }
  const windowMs = toMs - fromMs
  if (windowMs < MIN_WINDOW_MS || windowMs > MAX_WINDOW_MS) {
    throw new Error('fromMs/toMs must span roughly one day.')
  }
  if (!Number.isInteger(input.countedCash) || (input.countedCash as number) < 0) {
    throw new Error('countedCash must be a non-negative integer (cents).')
  }
  const date = input.date
  const countedCash = cents(input.countedCash as number)

  const closeRef = db.collection('dailyCloses').doc(date)

  return db.runTransaction(async (tx) => {
    const existing = await tx.get(closeRef)
    if (existing.exists) {
      throw new Error(`${date} is already closed.`)
    }

    const from = Timestamp.fromMillis(fromMs)
    const to = Timestamp.fromMillis(toMs)
    const ordersSnap = await tx.get(
      db.collection('salesOrders').where('confirmedAt', '>=', from).where('confirmedAt', '<', to),
    )

    let cashSalesTotal = 0
    let cardSalesTotal = 0
    let eTransferSalesTotal = 0
    for (const doc of ordersSnap.docs) {
      const order = doc.data() as SalesOrder
      if (order.paymentMethod === 'cash') cashSalesTotal += order.total
      else if (order.paymentMethod === 'card') cardSalesTotal += order.total
      else if (order.paymentMethod === 'eTransfer') eTransferSalesTotal += order.total
    }

    const cashVariance = cents(countedCash - cashSalesTotal)

    const close: WithFieldValue<DailyClose> = {
      date,
      from,
      to,
      cashSalesTotal: cents(cashSalesTotal),
      cardSalesTotal: cents(cardSalesTotal),
      eTransferSalesTotal: cents(eTransferSalesTotal),
      countedCash,
      cashVariance,
      closedAt: FieldValue.serverTimestamp(),
    }
    tx.set(closeRef, close)

    return {
      date,
      cashSalesTotal: cents(cashSalesTotal),
      cardSalesTotal: cents(cardSalesTotal),
      eTransferSalesTotal: cents(eTransferSalesTotal),
      countedCash,
      cashVariance,
    }
  })
}
