import { describe, expect, it } from 'vitest'
import { cents } from '../types'
import {
  adjustmentsReport,
  agingBuckets,
  buyerRevenue,
  donorRoiByModel,
  hstRemittanceReport,
  marginBySku,
  salesSummaryByPaymentMethod,
  yieldRateByModel,
} from './aggregations'
import type {
  AdjustmentMovementInput,
  BuyerInput,
  DonorRoiInput,
  PurchaseHstInput,
  SalesOrderForRemittance,
  SalesOrderForRevenue,
  SalesOrderForSummary,
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
        returnedCount: 0,
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
        returnedCount: 0,
        totalRevenue: 0,
        totalCost: 0,
        totalMargin: 0,
        avgMargin: null,
        marginPct: null,
      },
    ])
  })

  it('counts a restocked return (status back to inStock) as unsold, not as a loss', () => {
    // A restocked return clears soldPrice (processReturn.ts) — it's sellable
    // again, indistinguishable from any other inStock unit.
    const rows = marginBySku([item({ status: 'inStock', soldPrice: null })])
    expect(rows[0]).toMatchObject({ soldCount: 0, inStockCount: 1, returnedCount: 0, totalRevenue: 0, totalCost: 0 })
  })

  it('folds a written-off return (status returned, soldPrice kept as history) into cost with zero revenue', () => {
    const rows = marginBySku([
      item({ status: 'sold', soldPrice: cents(20000), allocatedCost: cents(16925) }),
      item({ status: 'returned', soldPrice: cents(20000), allocatedCost: cents(16925) }),
    ])
    expect(rows[0]).toMatchObject({
      soldCount: 1,
      returnedCount: 1,
      totalRevenue: 20000, // only the genuine sale counts as revenue
      totalCost: 16925 * 2, // both units' cost was spent; the returned one earned nothing back
      totalMargin: 20000 - 16925 * 2,
    })
  })

  it('excludes a teardown-scrapped item (never sold) from the returned-loss count', () => {
    // Distinguishes 'scrapped' (never sold, docs/SCHEMA.md §6) from
    // 'returned' (sold, then written off, §13) — the former is a normal,
    // separately-handled write-off with allocatedCost 0 (§4's redistribution),
    // not a margin loss on a sale that happened.
    const rows = marginBySku([item({ status: 'scrapped', soldPrice: null, allocatedCost: cents(0) })])
    expect(rows[0]).toMatchObject({ soldCount: 0, returnedCount: 0, totalCost: 0 })
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

describe('salesSummaryByPaymentMethod', () => {
  const RANGE = { from: new Date('2026-08-01T00:00:00Z'), to: new Date('2026-08-31T23:59:59.999Z') }

  const order = (overrides: Partial<SalesOrderForSummary> = {}): SalesOrderForSummary => ({
    paymentMethod: 'cash',
    confirmedAt: fakeTimestamp(new Date('2026-08-15T12:00:00Z')),
    subtotal: cents(1000),
    tax: cents(130),
    total: cents(1130),
    status: 'confirmed',
    ...overrides,
  })

  it('groups a cash order into the cash bucket', () => {
    const report = salesSummaryByPaymentMethod([order()], RANGE)
    expect(report.byMethod).toEqual([
      { method: 'cash', orderCount: 1, subtotal: 1000, tax: 130, total: 1130 },
      { method: 'card', orderCount: 0, subtotal: 0, tax: 0, total: 0 },
      { method: 'eTransfer', orderCount: 0, subtotal: 0, tax: 0, total: 0 },
      { method: 'account', orderCount: 0, subtotal: 0, tax: 0, total: 0 },
    ])
    expect(report.grandTotal).toEqual({ orderCount: 1, subtotal: 1000, tax: 130, total: 1130 })
  })

  it('buckets a null paymentMethod as account', () => {
    const report = salesSummaryByPaymentMethod([order({ paymentMethod: null })], RANGE)
    expect(report.byMethod.find((r) => r.method === 'account')).toMatchObject({ orderCount: 1 })
  })

  it('sums multiple orders in the same bucket', () => {
    const report = salesSummaryByPaymentMethod(
      [order({ paymentMethod: 'card', subtotal: cents(500), tax: cents(65), total: cents(565) }),
       order({ paymentMethod: 'card', subtotal: cents(300), tax: cents(39), total: cents(339) })],
      RANGE,
    )
    expect(report.byMethod.find((r) => r.method === 'card')).toEqual({
      method: 'card', orderCount: 2, subtotal: 800, tax: 104, total: 904,
    })
  })

  it('excludes a quoted order — it never happened yet', () => {
    const report = salesSummaryByPaymentMethod([order({ status: 'quoted', confirmedAt: null })], RANGE)
    expect(report.grandTotal.orderCount).toBe(0)
  })

  it('counts shipped and paid the same as confirmed', () => {
    const report = salesSummaryByPaymentMethod(
      [order({ status: 'shipped' }), order({ status: 'paid' })],
      RANGE,
    )
    expect(report.grandTotal.orderCount).toBe(2)
  })

  it('excludes an order confirmed before the range', () => {
    const report = salesSummaryByPaymentMethod(
      [order({ confirmedAt: fakeTimestamp(new Date('2026-07-31T23:59:59Z')) })],
      RANGE,
    )
    expect(report.grandTotal.orderCount).toBe(0)
  })

  it('excludes an order confirmed after the range', () => {
    const report = salesSummaryByPaymentMethod(
      [order({ confirmedAt: fakeTimestamp(new Date('2026-09-01T00:00:01Z')) })],
      RANGE,
    )
    expect(report.grandTotal.orderCount).toBe(0)
  })

  it('includes orders confirmed exactly at the range boundaries', () => {
    const report = salesSummaryByPaymentMethod(
      [order({ confirmedAt: fakeTimestamp(RANGE.from) }), order({ confirmedAt: fakeTimestamp(RANGE.to) })],
      RANGE,
    )
    expect(report.grandTotal.orderCount).toBe(2)
  })

  it('groups a wholesale quote by its confirm date, not its (earlier) quote date', () => {
    // Quoted in July, confirmed in August — belongs in the August summary.
    const report = salesSummaryByPaymentMethod(
      [order({ confirmedAt: fakeTimestamp(new Date('2026-08-05T00:00:00Z')) })],
      RANGE,
    )
    expect(report.grandTotal.orderCount).toBe(1)
  })
})

describe('hstRemittanceReport', () => {
  // Local-calendar dates (not UTC ISO strings) so monthKey/quarterKey's use
  // of local date fields lines up with what these tests construct,
  // regardless of the timezone the test runner happens to be in.
  const order = (overrides: Partial<SalesOrderForRemittance> = {}): SalesOrderForRemittance => ({
    status: 'confirmed',
    confirmedAt: fakeTimestamp(new Date(2026, 7, 15)), // Aug 15, 2026
    tax: cents(1300),
    ...overrides,
  })
  const purchase = (overrides: Partial<PurchaseHstInput> = {}): PurchaseHstInput => ({
    at: fakeTimestamp(new Date(2026, 7, 10)), // Aug 10, 2026
    hstPaidCAD: cents(400),
    ...overrides,
  })

  it('nets HST collected against HST paid for the month and quarter containing both', () => {
    const report = hstRemittanceReport([order()], [purchase()])
    expect(report.byMonth).toEqual([{ period: '2026-08', hstCollected: 1300, hstPaid: 400, netOwing: 900 }])
    expect(report.byQuarter).toEqual([{ period: '2026-Q3', hstCollected: 1300, hstPaid: 400, netOwing: 900 }])
  })

  it('excludes a quoted order — no tax was ever actually collected', () => {
    const report = hstRemittanceReport([order({ status: 'quoted', confirmedAt: null })], [])
    expect(report.byMonth).toEqual([])
  })

  it('counts shipped and paid the same as confirmed', () => {
    const report = hstRemittanceReport([order({ status: 'shipped' }), order({ status: 'paid' })], [])
    expect(report.byMonth[0].hstCollected).toBe(2600)
  })

  it('separates collected-only and paid-only periods when they fall in different months', () => {
    const report = hstRemittanceReport(
      [order({ confirmedAt: fakeTimestamp(new Date(2026, 7, 15)) })], // August
      [purchase({ at: fakeTimestamp(new Date(2026, 8, 5)) })], // September
    )
    const aug = report.byMonth.find((r) => r.period === '2026-08')!
    const sep = report.byMonth.find((r) => r.period === '2026-09')!
    expect(aug).toEqual({ period: '2026-08', hstCollected: 1300, hstPaid: 0, netOwing: 1300 })
    expect(sep).toEqual({ period: '2026-09', hstCollected: 0, hstPaid: 400, netOwing: -400 })
  })

  it('rolls July/August/September all into Q3, even though they are different months', () => {
    const report = hstRemittanceReport(
      [
        order({ confirmedAt: fakeTimestamp(new Date(2026, 6, 1)), tax: cents(100) }), // July
        order({ confirmedAt: fakeTimestamp(new Date(2026, 7, 1)), tax: cents(200) }), // August
        order({ confirmedAt: fakeTimestamp(new Date(2026, 8, 1)), tax: cents(300) }), // September
      ],
      [],
    )
    expect(report.byMonth).toHaveLength(3)
    expect(report.byQuarter).toEqual([{ period: '2026-Q3', hstCollected: 600, hstPaid: 0, netOwing: 600 }])
  })

  it('sorts periods chronologically', () => {
    const report = hstRemittanceReport(
      [
        order({ confirmedAt: fakeTimestamp(new Date(2027, 0, 1)) }), // Jan 2027
        order({ confirmedAt: fakeTimestamp(new Date(2026, 0, 1)) }), // Jan 2026
        order({ confirmedAt: fakeTimestamp(new Date(2026, 11, 1)) }), // Dec 2026
      ],
      [],
    )
    expect(report.byMonth.map((r) => r.period)).toEqual(['2026-01', '2026-12', '2027-01'])
  })

  it('returns an empty report when there is nothing to remit', () => {
    expect(hstRemittanceReport([], [])).toEqual({ byMonth: [], byQuarter: [] })
  })
})

describe('adjustmentsReport', () => {
  const movement = (overrides: Partial<AdjustmentMovementInput> = {}): AdjustmentMovementInput => ({
    movementId: 'mv1',
    at: fakeTimestamp(new Date('2026-09-01')),
    skuCode: 'MS-SCRN-IP14P-A-PULL',
    itemId: 'item1',
    qty: -1,
    note: 'Not on shelf during count',
    ...overrides,
  })

  it('maps a movement to a row, resolving the timestamp and renaming note to reason', () => {
    const rows = adjustmentsReport([movement()])
    expect(rows).toEqual([
      {
        movementId: 'mv1',
        at: new Date('2026-09-01'),
        skuCode: 'MS-SCRN-IP14P-A-PULL',
        itemId: 'item1',
        qty: -1,
        reason: 'Not on shelf during count',
      },
    ])
  })

  it('sorts newest first', () => {
    const rows = adjustmentsReport([
      movement({ movementId: 'old', at: fakeTimestamp(new Date('2026-08-01')) }),
      movement({ movementId: 'new', at: fakeTimestamp(new Date('2026-09-01')) }),
      movement({ movementId: 'middle', at: fakeTimestamp(new Date('2026-08-15')) }),
    ])
    expect(rows.map((r) => r.movementId)).toEqual(['new', 'middle', 'old'])
  })

  it('falls back to an empty skuCode for a null skuCode', () => {
    const rows = adjustmentsReport([movement({ skuCode: null })])
    expect(rows[0].skuCode).toBe('')
  })

  it('returns an empty report for no adjustment movements', () => {
    expect(adjustmentsReport([])).toEqual([])
  })
})
