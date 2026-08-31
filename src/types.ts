import type { Timestamp } from 'firebase/firestore'

// ---------------------------------------------------------------------------
// Money — docs/SCHEMA.md: "Store money as integer cents, not floats."
//
// Cents is branded so a plain `number` (e.g. a dollar amount) can never be
// passed where a money value is expected without an explicit conversion.
// Mirrors functions/src/lib/types.ts's Cents — duplicated rather than
// imported, since the frontend bundle and the functions codebase are
// deployed independently (see skus/SkuForm.tsx's enum-duplication note).
// ---------------------------------------------------------------------------

declare const CentsBrand: unique symbol
export type Cents = number & { readonly [CentsBrand]: true }

/** Asserts a plain number is a Cents value. The one place a bare number becomes money. */
export function cents(value: number): Cents {
  return value as Cents
}

// ---------------------------------------------------------------------------
// Enums — docs/SCHEMA.md. Duplicated from functions/src/lib/types.ts for the
// same reason as above.
// ---------------------------------------------------------------------------

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

export type Grade = 'A' | 'B' | 'C' | 'N'
export type Source = 'PULL' | 'AFT' | 'OEM'
export type TrackingMode = 'serialized' | 'bulk'
export type DonorCondition = 'A' | 'B' | 'C' | 'D'
export type DonorSource = 'local' | 'china' | 'trade-in'
export type PurchaseCurrency = 'CAD' | 'USD'
export type DonorStatus = 'intact' | 'tornDown' | 'resoldWhole'
export type StockItemStatus = 'inStock' | 'reserved' | 'sold' | 'scrapped' | 'returned'
export type BuyerType = 'repairShop' | 'broker' | 'exporter' | 'retail'
export type BuyerTier = 'standard' | 'preferred' | 'partner'
export type BuyerTerms = 'prepay' | 'net7' | 'net15'
export type SalesOrderStatus = 'quoted' | 'confirmed' | 'shipped' | 'paid'

// ---------------------------------------------------------------------------
// Firestore document shapes actually read/written by the frontend.
// ---------------------------------------------------------------------------

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

export interface Donor {
  id: string
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

export interface StockItem {
  id: string
  itemId: string
  skuCode: string
  donorId: string | null
  allocatedCost: Cents
  grade: Grade
  status: StockItemStatus
  location: string
  createdAt: Timestamp
  soldPrice: Cents | null
  soldDate: Timestamp | null
  buyerId: string
}

export interface BulkStock {
  skuCode: string
  qtyOnHand: number
  avgLandedCost: Cents
  lastReceivedAt: Timestamp
  reorderPoint: number
}

export interface BuyerContact {
  email?: string
}

export interface Buyer {
  buyerId: string
  name: string
  type: BuyerType
  tier: BuyerTier
  terms: BuyerTerms
  contact: BuyerContact
}

export interface OrderLine {
  skuCode: string
  itemId?: string
  qty: number
  unitPrice: Cents
  unitCost: Cents
}

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

export interface TeardownAllocation {
  skuCode: string
  expectedResale: Cents
  sharePct: number
  allocatedCost: Cents
}

export interface TeardownScrappedEntry {
  partType: PartType
  reason: string
}

export interface TeardownNotHarvestedEntry {
  partType: PartType
  reason: string
}

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
