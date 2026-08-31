import type { Firestore } from 'firebase-admin/firestore'
import { cancelOrder } from './cancelOrder.js'
import type { SalesOrder } from './types.js'

const MAX_AGE_DAYS = 7
const DAY_MS = 1000 * 60 * 60 * 24

export interface ExpireStaleQuotesResult {
  expiredOrderIds: string[]
}

/**
 * Sweeps every still-quoted order older than 7 days and cancels it —
 * reusing cancelOrder's transaction (same release-to-inStock, same
 * 'release' movement per item, just a different audit note) so there's
 * exactly one place that knows how to safely unwind a quote.
 *
 * Fetches all 'quoted' orders with a single-field equality query (no
 * composite index needed) and filters by age in code, rather than adding
 * a range filter on createdAt — 'quoted' orders are always a small,
 * bounded set (anything else has already moved to a terminal status), so
 * this stays cheap without needing an index deployment.
 *
 * Each order is cancelled in its own transaction; one order having moved
 * on (e.g. confirmed a moment after this query ran) fails that one
 * transaction and is skipped, not fatal to the sweep.
 */
export async function expireStaleQuotes(
  db: Firestore,
  { asOf = new Date(), maxAgeDays = MAX_AGE_DAYS }: { asOf?: Date; maxAgeDays?: number } = {},
): Promise<ExpireStaleQuotesResult> {
  const cutoff = asOf.getTime() - maxAgeDays * DAY_MS

  const staleSnap = await db.collection('salesOrders').where('status', '==', 'quoted').get()
  const staleOrderIds = staleSnap.docs
    .filter((doc) => (doc.data() as SalesOrder).createdAt.toDate().getTime() <= cutoff)
    .map((doc) => doc.id)

  const expiredOrderIds: string[] = []
  for (const orderId of staleOrderIds) {
    try {
      await cancelOrder(db, { orderId, note: 'auto-expired after 7 days' })
      expiredOrderIds.push(orderId)
    } catch {
      // Already moved on (confirmed/cancelled) between the query above and
      // this transaction — skip it, the sweep isn't fatal on one order.
    }
  }

  return { expiredOrderIds }
}
