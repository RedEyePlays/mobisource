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
  | 'release'

/** docs/SCHEMA.md §3 `stockMovements.brand`. */
export type MovementBrand = 'mobisource' | 'flipthattech'

/** docs/SCHEMA.md §3 `buyers.type`. */
export type BuyerType = 'repairShop' | 'broker' | 'exporter' | 'retail'

/** docs/SCHEMA.md §3 `buyers.tier` — worst-to-best; see the pricing rule under `salesOrders`. */
export type BuyerTier = 'standard' | 'preferred' | 'partner'

/** docs/SCHEMA.md §3 `buyers.terms`. */
export type BuyerTerms = 'prepay' | 'net7' | 'net15'

/** docs/SCHEMA.md §3 `buyers.taxStatus` — default 'taxable'. exempt/zeroRated both charge 0 HST; kept as separate statuses since they mean different things on a real return, even though this codebase treats them identically today (see calculateTax.ts). */
export type BuyerTaxStatus = 'taxable' | 'exempt' | 'zeroRated'

/** docs/SCHEMA.md §3 `salesOrders.status` — 'cancelled' is terminal, from either an explicit cancelOrder or the 7-day auto-expiry sweep (§14). */
export type SalesOrderStatus = 'quoted' | 'confirmed' | 'shipped' | 'paid' | 'cancelled'

/** docs/SCHEMA.md §3 `salesOrders.paymentMethod` — captured at confirm time for a counter sale; null for an on-account wholesale order. */
export type PaymentMethod = 'cash' | 'card' | 'eTransfer'

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
  /** docs/SCHEMA.md §3 — default 'taxable'. A doc written before this field existed has none; every reader treats that the same as 'taxable', so no backfill migration is needed. */
  taxStatus: BuyerTaxStatus
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
  /** Provisional (against the buyer's and config's current values) while status is 'quoted'; confirmOrder recomputes and freezes it — never touched again after that, even if the buyer's taxStatus or the configured rate later changes. */
  tax: Cents
  /** The rate actually applied, in basis points (1300 = 13%) — 0 if the buyer was exempt/zeroRated. Frozen at confirm time alongside `tax`. */
  taxRateBps: number
  /** The buyer's taxStatus as of confirm time, snapshotted for the same reason as taxRateBps. */
  taxStatus: BuyerTaxStatus
  total: Cents
  status: SalesOrderStatus
  createdAt: Timestamp
  /** Set by confirmOrder, once, the moment the sale actually happens — null while still 'quoted'. A wholesale quote can sit for days before confirm, so this (not createdAt) is what date-range reports (§16/§17/§18) group by; it never moves again after that first confirm. */
  confirmedAt: Timestamp | null
  /** Set by confirmOrder; null until confirmed, and stays null for an on-account order with no cash-register payment. */
  paymentMethod: PaymentMethod | null
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
  /** HST actually paid on this shipment, in CAD — an input tax credit (docs/SCHEMA.md §17). 0 when none was charged (most overseas aftermarket imports); entered once at receiving time, never recomputed from unitCostCAD, since tax treatment isn't derivable from the landed cost alone. */
  hstPaidCAD: Cents
  lines: BulkReceiptLine[]
}

/** `supplierSkuMap/{mapId}` — doc ID is a sanitized `{supplier}__{supplierSku}` slug. Suppliers send their own part numbers; skuCode is what bulkStock/stockMovements always record. */
export interface SupplierSkuMap {
  supplier: string
  supplierSku: string
  skuCode: string
}

// ---------------------------------------------------------------------------
// `config` — reference values that change rarely and are never client-
// written (same staff-read/write:false shape as skus/teardownProfiles).
// Seeded via scripts/seed.ts for the emulator; a real deployment updates
// these directly via the admin SDK, the same way teardownProfiles is
// maintained — no in-app editor exists for either, and this task didn't
// ask for one.
// ---------------------------------------------------------------------------

/** One entry in `config/tax`'s rate history. */
export interface TaxRateEntry {
  /** The rate takes effect at this instant, inclusive, and holds until a later entry's effectiveFrom. */
  effectiveFrom: Timestamp
  /** Basis points — 1300 = 13%. Integer, so tax math never touches a float. */
  rateBps: number
}

/** `config/tax` — dated so a rate change never moves the tax already charged on a past order (see calculateTax.ts / SalesOrder.taxRateBps). */
export interface TaxConfig {
  rates: TaxRateEntry[]
}

/** `config/business` — shown on invoices (docs/SCHEMA.md §11). */
export interface BusinessConfig {
  legalName: string
  address: string
  email: string
  phone: string
  /** CRA HST registration number. */
  hstNumber: string
}

// ---------------------------------------------------------------------------
// `invoices` (docs/SCHEMA.md §12) — a record, not a view. Everything on the
// doc is a snapshot taken when the invoice was issued: business details,
// buyer name/terms, and each line's human-readable description are copied
// in at issue time so a later edit to config/business, the buyer, or the
// SKU catalog can never retroactively change an already-issued invoice.
// subtotal/taxRateBps/tax/total are copied straight from the confirmed
// order, which is itself already frozen (§11) — never recomputed here.
// ---------------------------------------------------------------------------

/** One row of `invoices.lines`. */
export interface InvoiceLine {
  skuCode: string
  /** Composed at issue time from the SKU catalog, e.g. "SCRN · IP14P · Grade A" — snapshotted so a later SKU edit can't change an issued invoice. */
  description: string
  qty: number
  unitPrice: Cents
  lineTotal: Cents
}

/** `invoices/{orderId}` — doc ID is the source order's orderId; one confirmed order has exactly one invoice, and this makes re-issuing idempotent (see issueInvoice.ts). */
export interface Invoice {
  invoiceId: string
  /** Sequential, gap-free, never reused — assigned from counters/invoices in the same transaction that creates this doc. */
  invoiceNumber: number
  orderId: string
  issuedAt: Timestamp
  business: BusinessConfig
  buyerName: string
  buyerTerms: BuyerTerms
  lines: InvoiceLine[]
  subtotal: Cents
  taxRateBps: number
  tax: Cents
  total: Cents
}

/** `counters/invoices` — last invoice number issued; 0 (doc absent) before the first invoice. Read-and-incremented inside issueInvoice's transaction, so a failed issuance never consumes a number and a concurrent one can't collide. */
export interface InvoiceCounter {
  last: number
}

// ---------------------------------------------------------------------------
// `returns` / `creditNotes` (docs/SCHEMA.md §13) — a return is one event
// against a confirmed order, per line, each with its own reason and
// disposition. `stockItems.status: 'returned'` (§3) is reserved for a
// write-off return specifically — distinct from 'scrapped' (a teardown
// write-off that never sold), so a returned-and-written-off item is
// identifiable in reports as "sold, refunded, never recovered" rather than
// looking like it was never sold at all.
// ---------------------------------------------------------------------------

/** docs/SCHEMA.md §13 `returns.lines[].reason`. */
export type ReturnReason = 'DOA' | 'wrongPart' | 'changedMind'

/** docs/SCHEMA.md §13 `returns.lines[].disposition` — chosen per line, independent of reason. */
export type ReturnDisposition = 'restock' | 'writeOff'

/** One row of `returns.lines`. unitPrice/unitCost are snapshotted from the matching order line — never re-derived. */
export interface ReturnLine {
  skuCode: string
  /** Set for a serialized line (qty is always 1); omitted for a bulk line. */
  itemId?: string
  qty: number
  reason: ReturnReason
  disposition: ReturnDisposition
  unitPrice: Cents
  unitCost: Cents
}

/** `returns/{returnId}` — auto-id, since one order can have several separate return events over time. */
export interface Return {
  returnId: string
  orderId: string
  lines: ReturnLine[]
  /** Σ unitPrice × qty across all returned lines — the refunded amount before tax, regardless of each line's disposition (a write-off still refunds the buyer; disposition only decides what happens to the physical/bulk unit). */
  subtotal: Cents
  /** Copied from the order's frozen taxRateBps — never re-looked-up, for the same reason an order's own tax is frozen (§11). */
  taxRateBps: number
  /** The proportional tax reversed — calculateTax() applied to this return's own subtotal at the order's frozen rate, not a fraction of the order's original tax (avoids compounding rounding across partial returns). */
  tax: Cents
  total: Cents
  createdAt: Timestamp
}

/** One row of `creditNotes.lines` — same shape as an invoice line. */
export type CreditNoteLine = InvoiceLine

/** `creditNotes/{returnId}` — doc ID is the return event's own id (one return has exactly one credit note). A frozen record, like `invoices` — see issueInvoice.ts / processReturn.ts. */
export interface CreditNote {
  creditNoteId: string
  /** Sequential, gap-free, never reused — its own counter, separate from invoice numbers. */
  creditNoteNumber: number
  returnId: string
  orderId: string
  /** The invoice this credit note reverses, snapshotted from invoices/{orderId} at the moment of return. */
  invoiceNumber: number
  issuedAt: Timestamp
  business: BusinessConfig
  buyerName: string
  buyerTerms: BuyerTerms
  lines: CreditNoteLine[]
  subtotal: Cents
  taxRateBps: number
  tax: Cents
  total: Cents
}

/** `counters/creditNotes` — same shape and guarantee as InvoiceCounter, but its own independent sequence. */
export interface CreditNoteCounter {
  last: number
}

/** `expenses/{expenseId}` (docs/SCHEMA.md §17) — a recorded business expense with HST paid, the other source of input tax credits alongside bulkReceipts.hstPaidCAD. Auto-id, create-only — no update/delete path was asked for; a mistaken entry needs a correcting entry, same reasoning as an append-only ledger. */
export interface Expense {
  expenseId: string
  /** When the expense was incurred — user-supplied (like donors.purchaseDate), since it's normally recorded some time after the fact. */
  date: Timestamp
  description: string
  /** Total paid, in CAD cents, tax included. */
  amount: Cents
  /** The HST portion of `amount` — 0 if none was charged. */
  hstPaidCAD: Cents
  createdAt: Timestamp
}

/** `dailyCloses/{date}` (docs/SCHEMA.md §18) — doc ID is the closed date ('YYYY-MM-DD'), which is what locks a day: closeDay refuses to close the same date twice. A record, like an invoice — once written, never updated. */
export interface DailyClose {
  date: string
  /** The [from, to) window closeDay actually queried — kept for audit, since the window's local-midnight boundaries are supplied by the caller (see closeDay.ts). */
  from: Timestamp
  to: Timestamp
  cashSalesTotal: Cents
  cardSalesTotal: Cents
  eTransferSalesTotal: Cents
  /** What the cashier counted in the drawer. */
  countedCash: Cents
  /** countedCash - cashSalesTotal. Negative means short, positive means over. */
  cashVariance: Cents
  closedAt: Timestamp
}
