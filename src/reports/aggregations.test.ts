import { describe, expect, it } from 'vitest'
import { cents } from '../types'
import {
  agingBuckets,
  buyerRevenue,
  donorRoiByModel,
  marginBySku,
  yieldRateByModel,
} from './aggregations'
import type {
  BuyerInput,
  DonorRoiInput,
  SalesOrderForRevenue,
  SkuModelInput,
  StockItemForAging,
  StockItemForMargin,
  StockItemForRoi,
  StockItemForYield,
  TimestampLike,
} from './aggregations'

function fakeTimestamp(date: Date): TimestampLike {
  return { toDate: () => date }
}

describe('donorRoiByModel', () => {
  const donor = (overrides: Partial<DonorRoiInput> = {}): DonorRoiInput => ({
    id: 'donor1',
    model: 'IP14P',
    status: 'tornDown',
    purchaseCost: cents(40000),
    ...overrides,
  })
  const item = (overrides: Partial<StockItemForRoi> = {}): StockItemForRoi => ({
    donorId: 'donor1',
    status: 'sold',
    soldPrice: cents(20000),
    ...overrides,
  })

  it('computes roi for a single torn-down donor with one sold child', () => {
    const report = donorRoiByModel([donor()], [item()])
    expect(report.byDonor).toEqual([
      { donorId: 'donor1', model: 'IP14P', donorCost: 40000, soldRevenue: 20000, roi: 0.5, soldParts: 1, totalParts: 1 },
    ])
    expect(report.byModel).toEqual([
      {
        model: 'IP14P',
        donorCount: 1,
        totalDonorCost: 40000,
        totalSoldRevenue: 20000,
        roi: 0.5,
        soldParts: 1,
        totalParts: 1,
      },
    ])
  })

  it('pools revenue and cost across donors rather than averaging per-donor ratios', () => {
    // Donor A: $100 cost, $10 sold (roi 0.1). Donor B: $100 cost, $190 sold (roi 1.9).
    // Averaging the ratios gives 1.0; pooling gives (10+190)/(100+100) = 1.0 too by
    // coincidence here, so use an asymmetric cost split to tell them apart:
    // Donor A: $10 cost, $10 sold (roi 1.0). Donor B: $190 cost, $19 sold (roi 0.1).
    // Average of ratios = 0.55. Pooled = (10+19)/(10+190) = 0.145.
    const donors = [
      donor({ id: 'a', purchaseCost: cents(1000) }),
      donor({ id: 'b', purchaseCost: cents(19000) }),
    ]
    const items = [
      item({ donorId: 'a', soldPrice: cents(1000) }),
      item({ donorId: 'b', soldPrice: cents(1900) }),
    ]

    const report = donorRoiByModel(donors, items)
    expect(report.byModel).toHaveLength(1)
    expect(report.byModel[0].roi).toBeCloseTo(2900 / 20000, 10)
  })

  it('excludes intact and resoldWhole donors — they have no children yet', () => {
    const donors = [donor({ id: 'a', status: 'intact' }), donor({ id: 'b', status: 'resoldWhole' })]
    const report = donorRoiByModel(donors, [item({ donorId: 'a' }), item({ donorId: 'b' })])
    expect(report.byDonor).toEqual([])
    expect(report.byModel).toEqual([])
  })

  it('treats a donor cost of zero as an undefined roi rather than dividing by zero', () => {
    const report = donorRoiByModel([donor({ purchaseCost: cents(0) })], [item()])
    expect(report.byDonor[0].roi).toBeNull()
    expect(report.byModel[0].roi).toBeNull()
  })

  it('gives a donor with only scrapped/unsold children a zero, not null, roi', () => {
    const items: StockItemForRoi[] = [
      { donorId: 'donor1', status: 'scrapped', soldPrice: null },
      { donorId: 'donor1', status: 'inStock', soldPrice: null },
    ]
    const report = donorRoiByModel([donor()], items)
    expect(report.byDonor[0]).toMatchObject({ soldRevenue: 0, roi: 0, soldParts: 0, totalParts: 2 })
  })

  it('ignores stockItems with no donorId (bulk/unlinked items)', () => {
    const report = donorRoiByModel([donor()], [item({ donorId: null })])
    expect(report.byDonor[0]).toMatchObject({ soldParts: 0, totalParts: 0 })
  })

  it('sorts both levels descending by roi, with null roi last', () => {
    const donors = [
      donor({ id: 'zero-cost', model: 'ZERO', purchaseCost: cents(0) }),
      donor({ id: 'low', model: 'LOW', purchaseCost: cents(1000) }),
      donor({ id: 'high', model: 'HIGH', purchaseCost: cents(1000) }),
    ]
    const items = [
      item({ donorId: 'zero-cost', soldPrice: cents(100) }),
      item({ donorId: 'low', soldPrice: cents(100) }),
      item({ donorId: 'high', soldPrice: cents(900) }),
    ]
    const report = donorRoiByModel(donors, items)
    expect(report.byDonor.map((r) => r.donorId)).toEqual(['high', 'low', 'zero-cost'])
    expect(report.byModel.map((r) => r.model)).toEqual(['HIGH', 'LOW', 'ZERO'])
  })
})

describe('marginBySku', () => {
  const item = (overrides: Partial<StockItemForMargin> = {}): StockItemForMargin => ({
    skuCode: 'MS-SCRN-IP14P-A-PULL',
    status: 'sold',
    soldPrice: cents(20000),
    allocatedCost: cents(16925),
    ...overrides,
  })

  it('computes margin for a single sold item', () => {
    const rows = marginBySku([item()])
    expect(rows).toEqual([
      {
        skuCode: 'MS-SCRN-IP14P-A-PULL',
        soldCount: 1,
        inStockCount: 0,
        totalRevenue: 20000,
        totalCost: 16925,
        totalMargin: 3075,
        avgMargin: 3075,
        marginPct: 3075 / 20000,
      },
    ])
  })

  it('reports zero margin and null averages for a sku with no sales yet, alongside its inStock count', () => {
    const rows = marginBySku([
      item({ status: 'inStock', soldPrice: null }),
      item({ status: 'inStock', soldPrice: null }),
    ])
    expect(rows).toEqual([
      {
        skuCode: 'MS-SCRN-IP14P-A-PULL',
        soldCount: 0,
        inStockCount: 2,
        totalRevenue: 0,
        totalCost: 0,
        totalMargin: 0,
        avgMargin: null,
        marginPct: null,
      },
    ])
  })

  it('surfaces a negative margin when an item sold for less than its allocated cost', () => {
    const rows = marginBySku([item({ soldPrice: cents(10000), allocatedCost: cents(16925) })])
    expect(rows[0].totalMargin).toBe(10000 - 16925)
    expect(rows[0].marginPct).toBeLessThan(0)
  })

  it('does not let rounding remainders make totals inconsistent across multiple sold items', () => {
    const rows = marginBySku([
      item({ soldPrice: cents(100), allocatedCost: cents(70) }),
      item({ soldPrice: cents(100), allocatedCost: cents(70) }),
      item({ soldPrice: cents(100), allocatedCost: cents(70) }),
    ])
    expect(rows[0].totalMargin).toBe(90)
    expect(rows[0].avgMargin).toBeCloseTo(30, 10)
  })

  it('keeps a great margin on a couple of sales distinct from a pile still unsold', () => {
    const rows = marginBySku([
      item({ status: 'sold' }),
      item({ status: 'sold' }),
      ...Array.from({ length: 11 }, () => item({ status: 'inStock', soldPrice: null })),
    ])
    expect(rows[0].soldCount).toBe(2)
    expect(rows[0].inStockCount).toBe(11)
  })

  it('sorts multiple skus descending by total margin', () => {
    const rows = marginBySku([
      item({ skuCode: 'LOW', soldPrice: cents(100), allocatedCost: cents(90) }),
      item({ skuCode: 'HIGH', soldPrice: cents(100), allocatedCost: cents(10) }),
    ])
    expect(rows.map((r) => r.skuCode)).toEqual(['HIGH', 'LOW'])
  })
})

describe('yieldRateByModel', () => {
  const skus: SkuModelInput[] = [
    { skuCode: 'MS-SCRN-IP14P-A-PULL', model: 'IP14P' },
    { skuCode: 'MS-BATT-IP14P-B-PULL', model: 'IP14P' },
    { skuCode: 'MS-SCRN-IP13-A-PULL', model: 'IP13' },
  ]

  it('computes scrap rate for a single model', () => {
    const items: StockItemForYield[] = [
      { skuCode: 'MS-SCRN-IP14P-A-PULL', status: 'inStock' },
      { skuCode: 'MS-BATT-IP14P-B-PULL', status: 'scrapped' },
    ]
    const rows = yieldRateByModel(items, skus)
    expect(rows).toEqual([{ model: 'IP14P', totalCreated: 2, scrapped: 1, scrapRate: 0.5 }])
  })

  it('gives a model with zero scrapped parts a zero rate', () => {
    const items: StockItemForYield[] = [{ skuCode: 'MS-SCRN-IP14P-A-PULL', status: 'sold' }]
    const rows = yieldRateByModel(items, skus)
    expect(rows[0].scrapRate).toBe(0)
  })

  it('excludes items whose sku is not in the catalog', () => {
    const items: StockItemForYield[] = [{ skuCode: 'unknown-sku', status: 'scrapped' }]
    const rows = yieldRateByModel(items, skus)
    expect(rows).toEqual([])
  })

  it('sorts models descending by scrap rate', () => {
    const items: StockItemForYield[] = [
      { skuCode: 'MS-SCRN-IP14P-A-PULL', status: 'inStock' },
      { skuCode: 'MS-SCRN-IP13-A-PULL', status: 'scrapped' },
    ]
    const rows = yieldRateByModel(items, skus)
    expect(rows.map((r) => r.model)).toEqual(['IP13', 'IP14P'])
  })
})

describe('agingBuckets', () => {
  const NOW = new Date('2026-08-31T00:00:00Z')
  const daysAgo = (days: number) => fakeTimestamp(new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000))
  const item = (overrides: Partial<StockItemForAging> = {}): StockItemForAging => ({
    itemId: 'item1',
    skuCode: 'MS-SCRN-IP14P-A-PULL',
    status: 'inStock',
    createdAt: daysAgo(0),
    allocatedCost: cents(16925),
    ...overrides,
  })

  it('buckets items at the 30/60/90-day boundaries', () => {
    const items = [
      item({ itemId: 'a', createdAt: daysAgo(30) }),
      item({ itemId: 'b', createdAt: daysAgo(31) }),
      item({ itemId: 'c', createdAt: daysAgo(60) }),
      item({ itemId: 'd', createdAt: daysAgo(61) }),
      item({ itemId: 'e', createdAt: daysAgo(90) }),
      item({ itemId: 'f', createdAt: daysAgo(91) }),
    ]
    const report = agingBuckets(items, NOW)
    expect(report.buckets).toEqual([
      { bucket: '0-30', count: 1, totalValue: 16925 },
      { bucket: '31-60', count: 2, totalValue: 33850 },
      { bucket: '61-90', count: 2, totalValue: 33850 },
      { bucket: '90+', count: 1, totalValue: 16925 },
    ])
  })

  it('only counts items currently inStock', () => {
    const items = [item({ status: 'sold' }), item({ status: 'reserved' }), item({ status: 'scrapped' })]
    const report = agingBuckets(items, NOW)
    expect(report.buckets.every((b) => b.count === 0)).toBe(true)
  })

  it('clamps a createdAt in the future to zero days rather than going negative', () => {
    const future = fakeTimestamp(new Date(NOW.getTime() + 24 * 60 * 60 * 1000))
    const report = agingBuckets([item({ createdAt: future })], NOW)
    expect(report.buckets[0]).toEqual({ bucket: '0-30', count: 1, totalValue: 16925 })
    expect(report.oldest[0].days).toBe(0)
  })

  it('returns an empty report for no inStock items', () => {
    const report = agingBuckets([], NOW)
    expect(report.buckets.every((b) => b.count === 0 && b.totalValue === 0)).toBe(true)
    expect(report.oldest).toEqual([])
  })

  it('lists the oldest items first, limited to the requested count', () => {
    const items = [
      item({ itemId: 'youngest', createdAt: daysAgo(1) }),
      item({ itemId: 'oldest', createdAt: daysAgo(200) }),
      item({ itemId: 'middle', createdAt: daysAgo(50) }),
    ]
    const report = agingBuckets(items, NOW, 2)
    expect(report.oldest.map((r) => r.itemId)).toEqual(['oldest', 'middle'])
  })
})

describe('buyerRevenue', () => {
  const buyers: BuyerInput[] = [{ buyerId: 'buyer1', name: 'Acme Repair' }]
  const order = (overrides: Partial<SalesOrderForRevenue> = {}): SalesOrderForRevenue => ({
    buyerId: 'buyer1',
    total: cents(24000),
    status: 'confirmed',
    ...overrides,
  })

  it('sums realized revenue for a single buyer', () => {
    const rows = buyerRevenue([order(), order()], buyers)
    expect(rows).toEqual([{ buyerId: 'buyer1', buyerName: 'Acme Repair', orderCount: 2, totalRevenue: 48000 }])
  })

  it('excludes quoted orders — a quote is a reservation, not revenue', () => {
    const rows = buyerRevenue([order({ status: 'quoted' })], buyers)
    expect(rows).toEqual([])
  })

  it('counts shipped and paid orders as realized, same as confirmed', () => {
    const rows = buyerRevenue([order({ status: 'shipped' }), order({ status: 'paid' })], buyers)
    expect(rows[0].orderCount).toBe(2)
  })

  it('falls back to the buyerId when the buyer record is missing', () => {
    const rows = buyerRevenue([order({ buyerId: 'ghost' })], buyers)
    expect(rows[0].buyerName).toBe('ghost')
  })

  it('sorts buyers descending by total revenue', () => {
    const rows = buyerRevenue(
      [order({ buyerId: 'small', total: cents(100) }), order({ buyerId: 'buyer1', total: cents(48000) })],
      buyers,
    )
    expect(rows.map((r) => r.buyerId)).toEqual(['buyer1', 'small'])
  })
})
