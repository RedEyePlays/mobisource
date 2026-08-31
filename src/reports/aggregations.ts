import type { Cents, DonorStatus, SalesOrderStatus, StockItemStatus } from '../types'
import { cents } from '../types'

// ---------------------------------------------------------------------------
// Donor ROI by model — docs/SCHEMA.md §7.
//
// Pooled across donors, not averaged per-donor: Σ soldPrice of every sold
// child ÷ Σ donorCost, for all torn-down donors of that model. Averaging
// per-donor ratios would let one cheap donor with a lucky sale skew the
// model's number; pooling weights by dollars, which is what should drive a
// buying decision. A donor has no "children" until it's torn down, so
// intact/resoldWhole donors never enter this metric.
// ---------------------------------------------------------------------------

export interface DonorRoiInput {
  id: string
  model: string
  status: DonorStatus
  purchaseCost: Cents
}

export interface StockItemForRoi {
  donorId: string | null
  status: StockItemStatus
  soldPrice: Cents | null
}

export interface DonorRoiRow {
  donorId: string
  model: string
  donorCost: Cents
  soldRevenue: Cents
  roi: number | null
  soldParts: number
  totalParts: number
}

export interface ModelRoiRow {
  model: string
  donorCount: number
  totalDonorCost: Cents
  totalSoldRevenue: Cents
  roi: number | null
  soldParts: number
  totalParts: number
}

export interface DonorRoiReport {
  byDonor: DonorRoiRow[]
  byModel: ModelRoiRow[]
}

function sortByRoiDesc<T extends { roi: number | null }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => (b.roi ?? -Infinity) - (a.roi ?? -Infinity))
}

export function donorRoiByModel(donors: DonorRoiInput[], stockItems: StockItemForRoi[]): DonorRoiReport {
  const childrenByDonor = new Map<string, StockItemForRoi[]>()
  for (const item of stockItems) {
    if (!item.donorId) continue
    const list = childrenByDonor.get(item.donorId) ?? []
    list.push(item)
    childrenByDonor.set(item.donorId, list)
  }

  const byDonor: DonorRoiRow[] = donors
    .filter((donor) => donor.status === 'tornDown')
    .map((donor) => {
      const children = childrenByDonor.get(donor.id) ?? []
      const soldChildren = children.filter((child) => child.status === 'sold')
      const soldRevenue = cents(soldChildren.reduce((sum, child) => sum + (child.soldPrice ?? 0), 0))
      return {
        donorId: donor.id,
        model: donor.model,
        donorCost: donor.purchaseCost,
        soldRevenue,
        roi: donor.purchaseCost > 0 ? soldRevenue / donor.purchaseCost : null,
        soldParts: soldChildren.length,
        totalParts: children.length,
      }
    })

  const totalsByModel = new Map<
    string,
    { donorCount: number; totalDonorCost: number; totalSoldRevenue: number; soldParts: number; totalParts: number }
  >()
  for (const row of byDonor) {
    const totals = totalsByModel.get(row.model) ?? {
      donorCount: 0,
      totalDonorCost: 0,
      totalSoldRevenue: 0,
      soldParts: 0,
      totalParts: 0,
    }
    totals.donorCount += 1
    totals.totalDonorCost += row.donorCost
    totals.totalSoldRevenue += row.soldRevenue
    totals.soldParts += row.soldParts
    totals.totalParts += row.totalParts
    totalsByModel.set(row.model, totals)
  }

  const byModel: ModelRoiRow[] = Array.from(totalsByModel.entries()).map(([model, totals]) => ({
    model,
    donorCount: totals.donorCount,
    totalDonorCost: cents(totals.totalDonorCost),
    totalSoldRevenue: cents(totals.totalSoldRevenue),
    roi: totals.totalDonorCost > 0 ? totals.totalSoldRevenue / totals.totalDonorCost : null,
    soldParts: totals.soldParts,
    totalParts: totals.totalParts,
  }))

  return {
    byDonor: sortByRoiDesc(byDonor),
    byModel: sortByRoiDesc(byModel),
  }
}

// ---------------------------------------------------------------------------
// Margin per SKU — docs/SCHEMA.md §7/§13. soldPrice - allocatedCost, grouped
// by skuCode, over `sold` items. `inStockCount` rides alongside so a great
// margin on a couple of sales with a pile still unsold reads as the partial
// result it is.
//
// A returned item that got *restocked* (status back to 'inStock') is meant
// to just fall out of the sold set here — the sale is void, and it's
// sellable again, correctly counted in inStockCount instead. A returned
// item that got *written off* is different: `status: 'returned'` with
// `soldPrice` kept as history (processReturn.ts) marks a unit that was
// sold, refunded via its credit note, and never recovered — the allocated
// cost is a real, permanent loss with zero revenue. Folding that into
// totalCost with $0 revenue is what keeps a SKU with heavy DOA from just
// quietly losing its bad sales and looking clean.
// ---------------------------------------------------------------------------

export interface StockItemForMargin {
  skuCode: string
  status: StockItemStatus
  soldPrice: Cents | null
  allocatedCost: Cents
}

export interface SkuMarginRow {
  skuCode: string
  soldCount: number
  inStockCount: number
  /** Sold, then returned and written off — never restocked, never recovered. */
  returnedCount: number
  totalRevenue: Cents
  totalCost: Cents
  totalMargin: Cents
  avgMargin: Cents | null
  marginPct: number | null
}

export function marginBySku(stockItems: StockItemForMargin[]): SkuMarginRow[] {
  const bySku = new Map<string, StockItemForMargin[]>()
  for (const item of stockItems) {
    const list = bySku.get(item.skuCode) ?? []
    list.push(item)
    bySku.set(item.skuCode, list)
  }

  const rows: SkuMarginRow[] = Array.from(bySku.entries()).map(([skuCode, items]) => {
    const sold = items.filter((item) => item.status === 'sold')
    const inStockCount = items.filter((item) => item.status === 'inStock').length
    const writtenOffReturns = items.filter((item) => item.status === 'returned' && item.soldPrice != null)

    const totalRevenue = cents(sold.reduce((sum, item) => sum + (item.soldPrice ?? 0), 0))
    const soldCost = sold.reduce((sum, item) => sum + item.allocatedCost, 0)
    const writtenOffCost = writtenOffReturns.reduce((sum, item) => sum + item.allocatedCost, 0)
    const totalCost = cents(soldCost + writtenOffCost)
    const totalMargin = cents(totalRevenue - totalCost)

    return {
      skuCode,
      soldCount: sold.length,
      inStockCount,
      returnedCount: writtenOffReturns.length,
      totalRevenue,
      totalCost,
      totalMargin,
      avgMargin: sold.length > 0 ? cents(totalMargin / sold.length) : null,
      marginPct: totalRevenue > 0 ? totalMargin / totalRevenue : null,
    }
  })

  return rows.sort((a, b) => b.totalMargin - a.totalMargin)
}

// ---------------------------------------------------------------------------
// Yield (scrap) rate by model — docs/SCHEMA.md §7. scrapped ÷ total items
// created, by model. stockItems don't carry `model` themselves, so it's
// joined via skuCode -> skus.model. A notHarvested part never got a
// stockItem, so it's correctly outside "total created."
// ---------------------------------------------------------------------------

export interface StockItemForYield {
  skuCode: string
  status: StockItemStatus
}

export interface SkuModelInput {
  skuCode: string
  model: string
}

export interface YieldRow {
  model: string
  totalCreated: number
  scrapped: number
  scrapRate: number | null
}

export function yieldRateByModel(stockItems: StockItemForYield[], skus: SkuModelInput[]): YieldRow[] {
  const modelBySkuCode = new Map(skus.map((sku) => [sku.skuCode, sku.model]))

  const totalsByModel = new Map<string, { totalCreated: number; scrapped: number }>()
  for (const item of stockItems) {
    const model = modelBySkuCode.get(item.skuCode)
    if (!model) continue
    const totals = totalsByModel.get(model) ?? { totalCreated: 0, scrapped: 0 }
    totals.totalCreated += 1
    if (item.status === 'scrapped') totals.scrapped += 1
    totalsByModel.set(model, totals)
  }

  const rows: YieldRow[] = Array.from(totalsByModel.entries()).map(([model, totals]) => ({
    model,
    totalCreated: totals.totalCreated,
    scrapped: totals.scrapped,
    scrapRate: totals.totalCreated > 0 ? totals.scrapped / totals.totalCreated : null,
  }))

  return rows.sort((a, b) => (b.scrapRate ?? -Infinity) - (a.scrapRate ?? -Infinity))
}

// ---------------------------------------------------------------------------
// Aging — docs/SCHEMA.md §7. Days since createdAt where status = inStock,
// bucketed, plus the oldest items outright. `now` is a parameter (not
// Date.now() read internally) so this stays a pure, deterministically
// testable function.
// ---------------------------------------------------------------------------

export interface TimestampLike {
  toDate(): Date
}

export interface StockItemForAging {
  itemId: string
  skuCode: string
  status: StockItemStatus
  createdAt: TimestampLike
  allocatedCost: Cents
}

export type AgingBucketLabel = '0-30' | '31-60' | '61-90' | '90+'

const BUCKET_LABELS: readonly AgingBucketLabel[] = ['0-30', '31-60', '61-90', '90+']
const DAY_MS = 1000 * 60 * 60 * 24

function bucketFor(days: number): AgingBucketLabel {
  if (days <= 30) return '0-30'
  if (days <= 60) return '31-60'
  if (days <= 90) return '61-90'
  return '90+'
}

export interface AgingBucketRow {
  bucket: AgingBucketLabel
  count: number
  totalValue: Cents
}

export interface AgingOldestRow {
  itemId: string
  skuCode: string
  days: number
  allocatedCost: Cents
}

export interface AgingReportData {
  buckets: AgingBucketRow[]
  oldest: AgingOldestRow[]
}

export function agingBuckets(stockItems: StockItemForAging[], now: Date, oldestLimit = 10): AgingReportData {
  const inStockWithDays = stockItems
    .filter((item) => item.status === 'inStock')
    .map((item) => ({
      item,
      // Clamp negative ages (a createdAt in the future, e.g. clock skew) to 0
      // rather than let them land in a nonsensical bucket.
      days: Math.max(0, Math.floor((now.getTime() - item.createdAt.toDate().getTime()) / DAY_MS)),
    }))

  const bucketTotals = new Map<AgingBucketLabel, { count: number; totalValue: number }>(
    BUCKET_LABELS.map((label) => [label, { count: 0, totalValue: 0 }]),
  )
  for (const { item, days } of inStockWithDays) {
    const totals = bucketTotals.get(bucketFor(days))!
    totals.count += 1
    totals.totalValue += item.allocatedCost
  }

  const buckets: AgingBucketRow[] = BUCKET_LABELS.map((label) => {
    const totals = bucketTotals.get(label)!
    return { bucket: label, count: totals.count, totalValue: cents(totals.totalValue) }
  })

  const oldest: AgingOldestRow[] = [...inStockWithDays]
    .sort((a, b) => b.days - a.days)
    .slice(0, oldestLimit)
    .map(({ item, days }) => ({
      itemId: item.itemId,
      skuCode: item.skuCode,
      days,
      allocatedCost: item.allocatedCost,
    }))

  return { buckets, oldest }
}

// ---------------------------------------------------------------------------
// Buyer revenue — docs/SCHEMA.md §7. salesOrders grouped by buyerId. A
// `quoted` order is a pending reservation, not revenue yet, so only
// confirmed/shipped/paid orders count.
// ---------------------------------------------------------------------------

export interface SalesOrderForRevenue {
  buyerId: string
  total: Cents
  status: SalesOrderStatus
}

export interface BuyerInput {
  buyerId: string
  name: string
}

export interface BuyerRevenueRow {
  buyerId: string
  buyerName: string
  orderCount: number
  totalRevenue: Cents
}

const REALIZED_ORDER_STATUSES: readonly SalesOrderStatus[] = ['confirmed', 'shipped', 'paid']

export function buyerRevenue(salesOrders: SalesOrderForRevenue[], buyers: BuyerInput[]): BuyerRevenueRow[] {
  const nameByBuyerId = new Map(buyers.map((buyer) => [buyer.buyerId, buyer.name]))

  const totalsByBuyer = new Map<string, { orderCount: number; totalRevenue: number }>()
  for (const order of salesOrders) {
    if (!(REALIZED_ORDER_STATUSES as readonly string[]).includes(order.status)) continue
    const totals = totalsByBuyer.get(order.buyerId) ?? { orderCount: 0, totalRevenue: 0 }
    totals.orderCount += 1
    totals.totalRevenue += order.total
    totalsByBuyer.set(order.buyerId, totals)
  }

  const rows: BuyerRevenueRow[] = Array.from(totalsByBuyer.entries()).map(([buyerId, totals]) => ({
    buyerId,
    buyerName: nameByBuyerId.get(buyerId) ?? buyerId,
    orderCount: totals.orderCount,
    totalRevenue: cents(totals.totalRevenue),
  }))

  return rows.sort((a, b) => b.totalRevenue - a.totalRevenue)
}

// ---------------------------------------------------------------------------
// Adjustments report — docs/SCHEMA.md §15. Every stock correction (a
// cycle-count variance or a single-item status fix, adjustStock.ts) writes
// an 'adjust' stockMovements row; this just orders them for display —
// newest first, so "what was corrected, when, and why" reads chronologically.
// ---------------------------------------------------------------------------

export interface AdjustmentMovementInput {
  movementId: string
  at: TimestampLike
  skuCode: string | null
  itemId: string
  qty: number
  note: string
}

export interface AdjustmentRow {
  movementId: string
  at: Date
  skuCode: string
  itemId: string
  qty: number
  reason: string
}

export function adjustmentsReport(movements: AdjustmentMovementInput[]): AdjustmentRow[] {
  return movements
    .map((m) => ({
      movementId: m.movementId,
      at: m.at.toDate(),
      skuCode: m.skuCode ?? '',
      itemId: m.itemId,
      qty: m.qty,
      reason: m.note,
    }))
    .sort((a, b) => b.at.getTime() - a.at.getTime())
}
