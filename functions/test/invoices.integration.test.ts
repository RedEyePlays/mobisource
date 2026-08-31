import { initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import type { Firestore } from 'firebase-admin/firestore'
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createOrder } from '../src/lib/createOrder.js'
import { confirmOrder } from '../src/lib/confirmOrder.js'
import { issueInvoice } from '../src/lib/issueInvoice.js'

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  throw new Error('FIRESTORE_EMULATOR_HOST is not set — run this via `npm run test:integration`.')
}

let db: Firestore

beforeAll(() => {
  const app = initializeApp({ projectId: 'demo-mobisource' })
  db = getFirestore(app)
})

afterEach(async () => {
  const [host, port] = process.env.FIRESTORE_EMULATOR_HOST!.split(':')
  await fetch(
    `http://${host}:${port}/emulator/v1/projects/demo-mobisource/databases/(default)/documents`,
    { method: 'DELETE' },
  )
})

const SCRN = 'MS-SCRN-IP14P-A-PULL'

async function seedSku(overrides: Record<string, unknown> = {}) {
  await db.collection('skus').doc(SCRN).set({
    skuCode: SCRN, partType: 'SCRN', model: 'IP14P', grade: 'A', source: 'PULL',
    trackingMode: 'serialized', expectedResale: 22000,
    listPriceRetail: 26000, listPriceTier1: 24000, listPriceTier2: 22500, listPriceTier3: 21000,
    active: true,
    ...overrides,
  })
}

async function seedItem(id: string, overrides: Record<string, unknown> = {}) {
  await db.collection('stockItems').doc(id).set({
    itemId: id,
    skuCode: SCRN,
    donorId: 'donor1',
    allocatedCost: 16925,
    grade: 'A',
    status: 'inStock',
    location: '',
    createdAt: new Date('2026-08-30'),
    soldPrice: null,
    soldDate: null,
    buyerId: '',
    ...overrides,
  })
}

async function seedBuyer(id: string, overrides: Record<string, unknown> = {}) {
  await db.collection('buyers').doc(id).set({
    buyerId: id,
    name: 'Test Buyer',
    type: 'repairShop',
    tier: 'standard',
    terms: 'net15',
    contact: {},
    taxStatus: 'taxable',
    ...overrides,
  })
}

async function seedTaxConfig() {
  await db.collection('config').doc('tax').set({
    rates: [{ effectiveFrom: new Date('2010-07-01'), rateBps: 1300 }],
  })
}

async function seedBusinessConfig(overrides: Record<string, unknown> = {}) {
  await db.collection('config').doc('business').set({
    legalName: 'MobiSource Inc.',
    address: '123 Repair Lane, Brampton, ON L6T 0A1',
    email: 'accounts@mobisource.example',
    phone: '(555) 555-0100',
    hstNumber: '123456789 RT0001',
    ...overrides,
  })
}

beforeEach(async () => {
  await seedTaxConfig()
  await seedBusinessConfig()
})

async function seedConfirmedOrder(itemId: string, buyerId: string, buyerOverrides: Record<string, unknown> = {}) {
  await seedSku()
  await seedItem(itemId)
  await seedBuyer(buyerId, buyerOverrides)
  const { orderId } = await createOrder(db, { buyerId, itemIds: [itemId] })
  await confirmOrder(db, { orderId, paymentMethod: 'cash' })
  return orderId
}

describe('issueInvoice', () => {
  it('issues invoice #1 for the first invoice ever, with the order snapshotted onto it', async () => {
    const orderId = await seedConfirmedOrder('item1', 'buyer1')

    const invoice = await issueInvoice(db, { orderId })

    expect(invoice.invoiceId).toBe(orderId)
    expect(invoice.invoiceNumber).toBe(1)
    expect(invoice.orderId).toBe(orderId)
    expect(invoice.buyerName).toBe('Test Buyer')
    expect(invoice.buyerTerms).toBe('net15')
    expect(invoice.business.legalName).toBe('MobiSource Inc.')
    expect(invoice.subtotal).toBe(24000)
    expect(invoice.taxRateBps).toBe(1300)
    expect(invoice.tax).toBe(3120)
    expect(invoice.total).toBe(27120)
    expect(invoice.lines).toEqual([
      { skuCode: SCRN, description: 'SCRN · IP14P · Grade A', qty: 1, unitPrice: 24000, lineTotal: 24000 },
    ])

    const stored = (await db.collection('invoices').doc(orderId).get()).data()!
    expect(stored.invoiceNumber).toBe(1)

    const counter = (await db.collection('counters').doc('invoices').get()).data()!
    expect(counter.last).toBe(1)
  })

  it('assigns sequential, gap-free invoice numbers across different orders', async () => {
    const order1 = await seedConfirmedOrder('item1', 'buyer1')
    await seedItem('item2')
    const { orderId: order2 } = await createOrder(db, { buyerId: 'buyer1', itemIds: ['item2'] })
    await confirmOrder(db, { orderId: order2, paymentMethod: 'card' })

    const invoice1 = await issueInvoice(db, { orderId: order1 })
    const invoice2 = await issueInvoice(db, { orderId: order2 })

    expect(invoice1.invoiceNumber).toBe(1)
    expect(invoice2.invoiceNumber).toBe(2)
  })

  it('re-issuing the same order returns the identical invoice, without allocating a new number', async () => {
    const orderId = await seedConfirmedOrder('item1', 'buyer1')

    const first = await issueInvoice(db, { orderId })
    const second = await issueInvoice(db, { orderId })

    expect(second.invoiceNumber).toBe(first.invoiceNumber)
    expect(second).toEqual(first)

    const counter = (await db.collection('counters').doc('invoices').get()).data()!
    expect(counter.last).toBe(1)
  })

  it('rejects issuing an invoice for a still-quoted order', async () => {
    await seedSku()
    await seedItem('item1')
    await seedBuyer('buyer1')
    const { orderId } = await createOrder(db, { buyerId: 'buyer1', itemIds: ['item1'] })

    await expect(issueInvoice(db, { orderId })).rejects.toThrow(/quoted/)
  })

  it('rejects a nonexistent order', async () => {
    await expect(issueInvoice(db, { orderId: 'no-such-order' })).rejects.toThrow(/not found/)
  })

  it('charges $0 tax on the invoice for an exempt buyer, matching the frozen order', async () => {
    const orderId = await seedConfirmedOrder('item1', 'buyer1', { taxStatus: 'exempt' })

    const invoice = await issueInvoice(db, { orderId })

    expect(invoice.tax).toBe(0)
    expect(invoice.total).toBe(invoice.subtotal)
  })

  it('snapshots the SKU description at issue time — a later SKU catalog edit never touches an issued invoice', async () => {
    const orderId = await seedConfirmedOrder('item1', 'buyer1')
    const invoice = await issueInvoice(db, { orderId })
    expect(invoice.lines[0].description).toBe('SCRN · IP14P · Grade A')

    await seedSku({ model: 'IP15PM', grade: 'B' })

    const reFetched = await issueInvoice(db, { orderId })
    expect(reFetched.lines[0].description).toBe('SCRN · IP14P · Grade A')
  })

  it('snapshots the buyer name and business config at issue time — later edits never touch an issued invoice', async () => {
    const orderId = await seedConfirmedOrder('item1', 'buyer1')
    const invoice = await issueInvoice(db, { orderId })
    expect(invoice.buyerName).toBe('Test Buyer')

    await db.collection('buyers').doc('buyer1').update({ name: 'Renamed Buyer' })
    await seedBusinessConfig({ legalName: 'Renamed Business Inc.' })

    const reFetched = await issueInvoice(db, { orderId })
    expect(reFetched.buyerName).toBe('Test Buyer')
    expect(reFetched.business.legalName).toBe('MobiSource Inc.')
  })
})
