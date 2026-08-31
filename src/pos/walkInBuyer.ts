import { collection, getDocs, limit, query, where } from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { db, functions } from '../firebase'
import type { Buyer } from '../types'

const WALK_IN_NAME = 'Walk-in'

interface CreateBuyerResult {
  buyerId: string
}

/**
 * Every sale needs a buyer (docs/SCHEMA.md §3 salesOrders.buyerId), so the
 * POS defaults to a standing "Walk-in" retail buyer rather than requiring
 * the cashier to pick one for every counter sale. No schema change — this
 * is identified by name, not a dedicated flag, and created via the
 * existing createBuyer callable the first time none exists (self-
 * provisioning, no backfill script or deploy-time step needed).
 *
 * type: 'retail' is what makes resolveLinePrice give listPriceRetail with
 * no special-casing — see docs/SCHEMA.md §3 "Line pricing".
 *
 * Two POS sessions both loading for the very first time (empty buyers
 * collection) could theoretically each create their own "Walk-in" buyer —
 * accepted as a low-probability, low-harm race (an extra unused buyer row,
 * not a money or inventory issue) rather than adding a uniqueness
 * mechanism the rest of buyers/createBuyer doesn't have. The much more
 * likely version of this race — the *same* tab calling this twice, e.g.
 * React StrictMode's dev-mode double effect invocation — is worth
 * closing cheaply though: every call in one page load shares one in-flight
 * promise, so only one createBuyer ever fires per tab.
 */
let inFlight: Promise<Buyer> | null = null

export function getOrCreateWalkInBuyer(): Promise<Buyer> {
  if (!inFlight) {
    inFlight = fetchOrCreateWalkInBuyer().catch((err: unknown) => {
      inFlight = null // let a failed attempt be retried instead of caching the rejection forever
      throw err
    })
  }
  return inFlight
}

async function fetchOrCreateWalkInBuyer(): Promise<Buyer> {
  const snap = await getDocs(query(collection(db, 'buyers'), where('name', '==', WALK_IN_NAME), limit(1)))
  if (!snap.empty) {
    return snap.docs[0].data() as Buyer
  }

  const createBuyer = httpsCallable<Record<string, unknown>, CreateBuyerResult>(functions, 'createBuyer')
  const fields = {
    name: WALK_IN_NAME,
    type: 'retail' as const,
    tier: 'standard' as const,
    terms: 'prepay' as const,
    contact: {},
  }
  const result = await createBuyer(fields)
  return { buyerId: result.data.buyerId, ...fields }
}
