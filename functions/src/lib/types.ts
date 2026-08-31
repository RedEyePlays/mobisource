import type { Timestamp } from 'firebase-admin/firestore'

// ---------------------------------------------------------------------------
// Money — docs/SCHEMA.md: "Store money as integer cents, not floats."
//
// Cents is branded so a plain `number` (e.g. a dollar amount, or a count)
// can never be passed where a money value is expected without an explicit,
// visible conversion. Arithmetic on two Cents values still produces a plain
// `number` (TS doesn't propagate brands through operators), so call `cents()`
// again on the result before storing or returning it.
// ---------------------------------------------------------------------------

declare const CentsBrand: unique symbol
export type Cents = number & { readonly [CentsBrand]: true }

/** Asserts a plain number is a Cents value. The one place a bare number becomes money. */
export function cents(value: number): Cents {
  return value as Cents
}

// ---------------------------------------------------------------------------
// Enums — every closed set of string values named in docs/SCHEMA.md.
// ---------------------------------------------------------------------------

/** docs/SCHEMA.md §1 "Part codes" table. */
export type PartType =
  | 'SCRN'
  | 'LOGIC'
  | 'HOUSASM'
  | 'HOUS'
  | 'BGLS'
  | 'BATT'
  | 'CAMR'
  | 'CAMF'
  | 'CHRG'
  | 'NFC'
  | 'SPKR'
  | 'EARP'
  | 'PROX'
  | 'FLSH'
  | 'TAPT'

/** docs/SCHEMA.md §1 — SKU cosmetic/functional grade. Not donors.condition (§3) — different enum, same letters. */
export type Grade = 'A' | 'B' | 'C' | 'N'

/** docs/SCHEMA.md §1. */
export type Source = 'PULL' | 'AFT' | 'OEM'

/** docs/SCHEMA.md §2. */
export type TrackingMode = 'serialized' | 'bulk'

/** docs/SCHEMA.md §3 `donors.condition` — donor grade, maps to TeardownProfileGrade. */
export type DonorCondition = 'A' | 'B' | 'C' | 'D'

/** docs/SCHEMA.md §3 `donors.source` — how the donor was acquired. Not skus.source. */
export type DonorSource = 'local' | 'china' | 'trade-in'

/** docs/SCHEMA.md §3 `donors.purchaseCurrency`. */
export type PurchaseCurrency = 'CAD' | 'USD'

/** docs/SCHEMA.md §3 `donors.status`. */
export type DonorStatus = 'intact' | 'tornDown' | 'resoldWhole'

/** docs/SCHEMA.md §3 `stockItems.status`. */
export type StockItemStatus = 'inStock' | 'reserved' | 'sold' | 'scrapped' | 'returned'

/** docs/SCHEMA.md §3 `stockMovements.type`. */
export type MovementType =
  | 'receive'
  | 'teardownIn'
  | 'teardownOut'
  | 'sale'
  | 'return'
  | 'scrap'
  | 'adjust'
  | 'transfer'

/** docs/SCHEMA.md §3 `stockMovements.brand`. */
export type MovementBrand = 'mobisource' | 'flipthattech'

/** docs/SCHEMA.md §3 `buyers.type`. */
export type BuyerType = 'repairShop' | 'broker' | 'exporter' | 'retail'

/** docs/SCHEMA.md §3 `buyers.tier` — worst-to-best; see the pricing rule under `salesOrders`. */
export type BuyerTier = 'standard' | 'preferred' | 'partner'

/** docs/SCHEMA.md §3 `buyers.terms`. */
export type BuyerTerms = 'prepay' | 'net7' | 'net15'

/** docs/SCHEMA.md §3 `salesOrders.status`. */
export type SalesOrderStatus = 'quoted' | 'confirmed' | 'shipped' | 'paid'

/** docs/SCHEMA.md §3.5 `teardownProfiles.donorGrade` — a group of two DonorCondition values. */
export type TeardownProfileGrade = 'AB' | 'CD'

// ---------------------------------------------------------------------------
// Firestore document interfaces — one per collection in docs/SCHEMA.md §3/§3.5.
// ---------------------------------------------------------------------------

/** `skus/{skuCode}` */
export interface Sku {
  skuCode: string
  partType: PartType
  model: string
  grade: Grade
  source: Source
  trackingMode: TrackingMode
  listPriceRetail: Cents
  listPriceTier1: Cents
  listPriceTier2: Cents
  listPriceTier3: Cents
  expectedResale: Cents
  active: boolean
}

/** `donors/{donorId}` */
export interface Donor {
  model: string
  imei: string
  imeiBlankReason: string
  purchaseCost: Cents
  purchaseCurrency: PurchaseCurrency
  fxRateUsed: number | null
  purchaseDate: Timestamp
  source: DonorSource
  supplierRef: string
  condition: DonorCondition
  status: DonorStatus
  teardownId: string
  resoldPrice: Cents | null
  resoldDate: Timestamp | null
  resoldBuyerId: string
  notes: string
}

/** `stockItems/{itemId}` */
export interface StockItem {
  itemId: string
  skuCode: string
  donorId: string | null
  allocatedCost: Cents
  /** The SKU's grade (Grade) — not the donor's condition (DonorCondition). */
  grade: Grade
  status: StockItemStatus
  location: string
  createdAt: Timestamp
  soldPrice: Cents | null
  soldDate: Timestamp | null
  buyerId: string
}

/** `bulkStock/{skuCode}` */
export interface BulkStock {
  skuCode: string
  qtyOnHand: number
  avgLandedCost: Cents
  lastReceivedAt: Timestamp
  reorderPoint: number
}

/** One row of `teardowns.allocations` — sellable parts only. */
export interface TeardownAllocation {
  skuCode: string
  expectedResale: Cents
  sharePct: number
  allocatedCost: Cents
}

/** One row of `teardowns.scrapped`. */
export interface TeardownScrappedEntry {
  partType: PartType
  reason: string
}

/** One row of `teardowns.notHarvested`. */
export interface TeardownNotHarvestedEntry {
  partType: PartType
  reason: string
}

/** `teardowns/{teardownId}` */
export interface Teardown {
  teardownId: string
  donorId: string
  performedAt: Timestamp
  donorCost: Cents
  allocations: TeardownAllocation[]
  itemsCreated: string[]
  scrapped: TeardownScrappedEntry[]
  notHarvested: TeardownNotHarvestedEntry[]
  costCheck: Cents
}

/** `stockMovements/{movementId}` */
export interface StockMovement {
  movementId: string
  at: Timestamp
  type: MovementType
  skuCode: string | null
  itemId: string
  qty: number
  unitCost: Cents
  ref: string
  brand: MovementBrand
  note: string
}

export interface BuyerContact {
  email?: string
}

/** `buyers/{buyerId}` */
export interface Buyer {
  buyerId: string
  name: string
  type: BuyerType
  tier: BuyerTier
  terms: BuyerTerms
  contact: BuyerContact
}

/** One row of `salesOrders.lines`. `itemId` is set for a serialized line, omitted for a bulk line. */
export interface OrderLine {
  skuCode: string
  itemId?: string
  qty: number
  unitPrice: Cents
  unitCost: Cents
}

/** `salesOrders/{orderId}` */
export interface SalesOrder {
  orderId: string
  buyerId: string
  lines: OrderLine[]
  subtotal: Cents
  tax: Cents
  total: Cents
  status: SalesOrderStatus
  createdAt: Timestamp
}

/** One row of `teardownProfiles.expectedParts`. */
export interface ExpectedPart {
  skuCode: string
  /** How often this part actually comes out sellable, 0-1. */
  likelihood: number
}

/** `teardownProfiles/{profileId}` */
export interface TeardownProfile {
  profileId: string
  model: string
  donorGrade: TeardownProfileGrade
  expectedParts: ExpectedPart[]
}

/** docs/SCHEMA.md §7 `bulkReceipts.shippingStatus`. */
export type ReceiptShippingStatus = 'included' | 'pending' | 'applied'

/** One row of `bulkReceipts.lines`. */
export interface BulkReceiptLine {
  skuCode: string
  supplierSku: string
  qty: number
  unitCostUSD: Cents
  unitCostCAD: Cents
  /** Flat per-unit shipping override for oversized items in this line, in its own currency. Null if this line splits shipping like everyone else. */
  shippingOverrideCurrency: PurchaseCurrency | null
  shippingOverrideAmount: Cents | null
  shippingOverrideAmountCAD: Cents | null
  /** This line's total shipping share (qty × per-unit), in CAD. 0 while shippingStatus is 'pending'. */
  shippingAllocatedCAD: Cents
  /** unitCostCAD + this line's per-unit shipping share. Equals unitCostCAD while shippingStatus is 'pending'. */
  landedCostCAD: Cents
  /** Set only once shipping has been applied after being pending — how many of this line's units bulkStock still had on hand to absorb the correction into. */
  unitsCorrected: number | null
  /** Set only once shipping has been applied after being pending — the shipping cost for units of this line already sold before the correction landed; never charged back to those sales. */
  discrepancyCAD: Cents | null
}

/** `bulkReceipts/{receiptId}` — the audit trail: fxRate and the original USD costs, so a wrong conversion is traceable after the fact. */
export interface BulkReceipt {
  receiptId: string
  supplier: string
  invoiceRef: string
  fxRate: number
  receivedAt: Timestamp
  shippingStatus: ReceiptShippingStatus
  shippingCurrency: PurchaseCurrency | null
  shippingTotal: Cents | null
  shippingTotalCAD: Cents | null
  shippingAppliedAt: Timestamp | null
  /** Σ lines[].discrepancyCAD — shipping cost from a late application that landed on already-sold units and was never absorbed. 0 unless that's happened. */
  totalDiscrepancyCAD: Cents
  lines: BulkReceiptLine[]
}

/** `supplierSkuMap/{mapId}` — doc ID is a sanitized `{supplier}__{supplierSku}` slug. Suppliers send their own part numbers; skuCode is what bulkStock/stockMovements always record. */
export interface SupplierSkuMap {
  supplier: string
  supplierSku: string
  skuCode: string
}
