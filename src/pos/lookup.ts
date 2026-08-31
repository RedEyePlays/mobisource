import { collection, doc, getDoc, getDocs, query, where } from 'firebase/firestore'
import { db } from '../firebase'
import type { Sku, StockItem } from '../types'

// A printed label's QR encodes exactly the string a scanner types: a
// harvested label's QR is the stockItem's itemId (its own Firestore doc
// ID); a bulk label's QR is the skuCode (also its own doc ID) — see
// print-service/src/zpl.ts and docs/SCHEMA.md §2. So resolving a scan is
// just: is this a stockItem doc ID, else is this a skus doc ID.
export type ScanResolution =
  | { kind: 'item'; item: StockItem }
  | { kind: 'itemNotAvailable'; item: StockItem }
  | { kind: 'bulkSku'; sku: Sku }
  | { kind: 'serializedSku'; sku: Sku }
  | { kind: 'notFound' }

export async function resolveScan(rawValue: string): Promise<ScanResolution> {
  const value = rawValue.trim()
  if (!value) return { kind: 'notFound' }

  const itemSnap = await getDoc(doc(db, 'stockItems', value))
  if (itemSnap.exists()) {
    const item = itemSnap.data() as StockItem
    return item.status === 'inStock' ? { kind: 'item', item } : { kind: 'itemNotAvailable', item }
  }

  const skuSnap = await getDoc(doc(db, 'skus', value))
  if (skuSnap.exists()) {
    const sku = skuSnap.data() as Sku
    return sku.trackingMode === 'bulk' ? { kind: 'bulkSku', sku } : { kind: 'serializedSku', sku }
  }

  return { kind: 'notFound' }
}

/** In-stock items for a serialized SKU picked via manual search (no specific item scanned yet). */
export async function findInStockItemsForSku(skuCode: string): Promise<StockItem[]> {
  const snap = await getDocs(
    query(collection(db, 'stockItems'), where('skuCode', '==', skuCode), where('status', '==', 'inStock')),
  )
  return snap.docs.map((d) => d.data() as StockItem)
}
