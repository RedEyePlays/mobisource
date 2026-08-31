import type { DocumentReference, Firestore, WithFieldValue } from 'firebase-admin/firestore'
import { FieldValue } from 'firebase-admin/firestore'
import type { BulkStock, Sku, StockItem, StockItemStatus, StockMovement } from './types.js'

const STATUSES: readonly StockItemStatus[] = ['inStock', 'reserved', 'sold', 'scrapped', 'returned']

export interface AdjustStockInput {
  /** Exactly one of itemId or skuCode must be set — a single item's status, or a SKU's whole count. */
  itemId?: unknown
  skuCode?: unknown
  /** itemId mode: the corrected status. */
  newStatus?: unknown
  /** skuCode mode: the corrected total quantity — bulkStock.qtyOnHand, or the count of inStock stockItems for a serialized SKU. */
  newQty?: unknown
  reason: unknown
}

export interface AdjustStockResult {
  /** false only when the correction is a no-op (already matches — nothing to write). */
  applied: boolean
  /** Net counted-stock change actually applied (may span several movements in serialized skuCode mode). */
  delta: number
  movementIds: string[]
}

type ParsedInput =
  | { mode: 'item'; itemId: string; newStatus: StockItemStatus; reason: string }
  | { mode: 'sku'; skuCode: string; newQty: number; reason: string }

function parseInput(input: AdjustStockInput): ParsedInput {
  const { itemId, skuCode, newStatus, newQty, reason } = input
  if (typeof reason !== 'string' || !reason.trim()) {
    throw new Error('reason is required.')
  }
  const hasItem = itemId != null
  const hasSku = skuCode != null
  if (hasItem === hasSku) {
    throw new Error('Provide exactly one of itemId or skuCode.')
  }

  if (hasItem) {
    if (typeof itemId !== 'string' || !itemId) {
      throw new Error('itemId must be a string.')
    }
    if (!(STATUSES as readonly string[]).includes(newStatus as string)) {
      throw new Error(`newStatus must be one of ${STATUSES.join(', ')}.`)
    }
    return { mode: 'item', itemId, newStatus: newStatus as StockItemStatus, reason }
  }

  if (typeof skuCode !== 'string' || !skuCode) {
    throw new Error('skuCode must be a string.')
  }
  if (!Number.isInteger(newQty) || (newQty as number) < 0) {
    throw new Error('newQty must be a non-negative integer.')
  }
  return { mode: 'sku', skuCode, newQty: newQty as number, reason }
}

function newMovementRef(db: Firestore) {
  return db.collection('stockMovements').doc()
}

function buildMovement(
  db: Firestore,
  fields: Pick<StockMovement, 'skuCode' | 'itemId' | 'qty' | 'unitCost' | 'note'>,
): { ref: DocumentReference; movement: WithFieldValue<StockMovement> } {
  const ref = newMovementRef(db)
  const movement: WithFieldValue<StockMovement> = {
    movementId: ref.id,
    at: FieldValue.serverTimestamp(),
    type: 'adjust',
    ref: '',
    brand: 'mobisource',
    ...fields,
  }
  return { ref, movement }
}

/**
 * Corrects the system's record of stock to match physical reality — either
 * one serialized item's status, or a whole SKU's counted quantity (used by
 * the cycle-count screen). Never edits history: every correction writes a
 * new 'adjust' movement carrying the delta actually applied, alongside the
 * status/quantity change, in the same transaction.
 *
 * A SKU-level count can only ever *decrease* a serialized SKU's counted
 * stock (by writing off however many units are missing) — it can't
 * materialize a "found" unit, since every serialized stockItem needs a
 * real cost basis from a donor teardown or intake, and a headcount alone
 * has none. A missing unit's disposition is a write-off ('scrapped'); if
 * it turns out to be a specific known item, adjust that item directly by
 * itemId instead.
 */
export async function adjustStock(db: Firestore, input: AdjustStockInput): Promise<AdjustStockResult> {
  const parsed = parseInput(input)

  if (parsed.mode === 'item') {
    return db.runTransaction(async (tx) => {
      const itemRef = db.collection('stockItems').doc(parsed.itemId)
      const snap = await tx.get(itemRef)
      if (!snap.exists) {
        throw new Error(`stockItem not found: ${parsed.itemId}`)
      }
      const item = snap.data() as StockItem
      if (item.status === parsed.newStatus) {
        return { applied: false, delta: 0, movementIds: [] }
      }

      const wasCounted = item.status === 'inStock'
      const isCounted = parsed.newStatus === 'inStock'
      const delta = (isCounted ? 1 : 0) - (wasCounted ? 1 : 0)

      tx.update(itemRef, { status: parsed.newStatus } satisfies WithFieldValue<Pick<StockItem, 'status'>>)

      const { ref, movement } = buildMovement(db, {
        skuCode: item.skuCode,
        itemId: parsed.itemId,
        qty: delta,
        unitCost: item.allocatedCost,
        note: `${parsed.reason} (${item.status} -> ${parsed.newStatus})`,
      })
      tx.set(ref, movement)

      return { applied: true, delta, movementIds: [ref.id] }
    })
  }

  return db.runTransaction(async (tx) => {
    const skuRef = db.collection('skus').doc(parsed.skuCode)
    const skuSnap = await tx.get(skuRef)
    if (!skuSnap.exists) {
      throw new Error(`SKU not found: ${parsed.skuCode}`)
    }
    const sku = skuSnap.data() as Sku

    if (sku.trackingMode === 'bulk') {
      const bulkRef = db.collection('bulkStock').doc(parsed.skuCode)
      const bulkSnap = await tx.get(bulkRef)
      if (!bulkSnap.exists) {
        throw new Error(`bulkStock has no cost basis yet for ${parsed.skuCode} — receive it before adjusting its count.`)
      }
      const stock = bulkSnap.data() as BulkStock
      const delta = parsed.newQty - stock.qtyOnHand
      if (delta === 0) {
        return { applied: false, delta: 0, movementIds: [] }
      }

      tx.update(bulkRef, { qtyOnHand: parsed.newQty } satisfies WithFieldValue<Pick<BulkStock, 'qtyOnHand'>>)

      const { ref, movement } = buildMovement(db, {
        skuCode: parsed.skuCode,
        itemId: '',
        qty: delta,
        unitCost: stock.avgLandedCost,
        note: parsed.reason,
      })
      tx.set(ref, movement)

      return { applied: true, delta, movementIds: [ref.id] }
    }

    const inStockSnap = await tx.get(
      db.collection('stockItems').where('skuCode', '==', parsed.skuCode).where('status', '==', 'inStock'),
    )
    const currentQty = inStockSnap.size
    const delta = parsed.newQty - currentQty
    if (delta === 0) {
      return { applied: false, delta: 0, movementIds: [] }
    }
    if (delta > 0) {
      throw new Error(
        `Counted ${parsed.newQty} for ${parsed.skuCode} but only ${currentQty} are tracked as inStock — a ` +
          `serialized SKU's count can't be increased without a real source (donor teardown or intake); adjust a ` +
          `specific item by itemId if one was found, not lost.`,
      )
    }

    const toWriteOff = inStockSnap.docs.slice(0, -delta)
    const movementIds: string[] = []
    for (const doc of toWriteOff) {
      const item = doc.data() as StockItem
      tx.update(doc.ref, { status: 'scrapped' } satisfies WithFieldValue<Pick<StockItem, 'status'>>)
      const { ref, movement } = buildMovement(db, {
        skuCode: parsed.skuCode,
        itemId: item.itemId,
        qty: -1,
        unitCost: item.allocatedCost,
        note: parsed.reason,
      })
      tx.set(ref, movement)
      movementIds.push(ref.id)
    }

    return { applied: true, delta, movementIds }
  })
}
