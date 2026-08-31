import type { Firestore, WithFieldValue } from 'firebase-admin/firestore'
import { FieldValue } from 'firebase-admin/firestore'
import { allocateDonorCost } from './allocateDonorCost.js'
import { cents } from './types.js'
import type {
  Cents,
  Donor,
  DonorCondition,
  Sku,
  StockItem,
  StockMovement,
  Teardown,
  TeardownAllocation,
  TeardownNotHarvestedEntry,
  TeardownProfile,
  TeardownProfileGrade,
  TeardownScrappedEntry,
} from './types.js'

const SELLABLE = 'sellable'
const SCRAPPED = 'scrapped'

/** donors.condition (A|B|C|D) -> teardownProfiles.donorGrade (AB|CD), per SCHEMA.md §3.5. */
export function mapDonorGradeToProfileGrade(condition: DonorCondition): TeardownProfileGrade {
  if (condition === 'A' || condition === 'B') return 'AB'
  if (condition === 'C' || condition === 'D') return 'CD'
  throw new Error(`Unknown donor condition: ${condition}`)
}

/**
 * The invariant from SCHEMA.md §4/§5: every dollar of donorCost is
 * accounted for by exactly the sellable parts' allocatedCost, no more, no
 * less. allocateDonorCost already guarantees this by construction; this
 * is the explicit, separately-testable assertion the teardown transaction
 * checks right before it commits.
 */
export function assertAllocationSumsToDonorCost(allocatedCosts: number[], donorCostCents: number): void {
  const sum = allocatedCosts.reduce((total, cost) => total + cost, 0)
  if (sum !== donorCostCents) {
    throw new Error(`Allocated costs sum to ${sum}, expected ${donorCostCents}.`)
  }
}

interface SubmittedPart {
  skuCode: string
  outcome: string
  reason?: string
}

function validateSubmittedParts(parts: unknown): Map<string, SubmittedPart> {
  if (!Array.isArray(parts)) {
    throw new Error('parts must be an array.')
  }

  const byCode = new Map<string, SubmittedPart>()
  for (const part of parts as SubmittedPart[]) {
    if (byCode.has(part.skuCode)) {
      throw new Error(`Duplicate skuCode in parts: ${part.skuCode}`)
    }
    if (part.outcome !== SELLABLE && part.outcome !== SCRAPPED) {
      throw new Error(`Invalid outcome for ${part.skuCode}: ${part.outcome}`)
    }
    if (part.outcome === SCRAPPED && !part.reason?.trim()) {
      throw new Error(`reason is required for a scrapped part: ${part.skuCode}`)
    }
    byCode.set(part.skuCode, part)
  }
  return byCode
}

export interface TeardownDonorInput {
  donorId: string
  parts: unknown
}

interface SellablePart {
  skuCode: string
  expectedResaleCents: Cents
  grade: string
}

interface ScrappedPart {
  skuCode: string
  grade: string
  partType: string
  reason: string
}

/**
 * Performs a teardown per SCHEMA.md §5, atomically. `db` is a Firestore
 * instance (admin SDK) so this is callable directly from tests against
 * the emulator, without going through the onCall wrapper.
 *
 * parts: [{ skuCode, outcome: 'sellable' | 'scrapped', reason? }]
 * Any of the profile's expectedParts not present in `parts` is treated as
 * notHarvested. A submitted skuCode outside the profile is allowed (an
 * unexpected part that genuinely came out) but must already exist as an
 * active SKU — allocation needs its expectedResale, and there's nowhere
 * to get one for a SKU that doesn't exist yet or has been deactivated.
 */
export async function teardownDonor(
  db: Firestore,
  { donorId, parts }: TeardownDonorInput,
): Promise<{ teardownId: string; itemsCreated: string[] }> {
  if (!donorId) {
    throw new Error('donorId is required.')
  }
  const submitted = validateSubmittedParts(parts)
  const teardownRef = db.collection('teardowns').doc()

  return db.runTransaction(async (tx) => {
    const donorRef = db.collection('donors').doc(donorId)
    const donorSnap = await tx.get(donorRef)
    if (!donorSnap.exists) {
      throw new Error(`Donor not found: ${donorId}`)
    }
    const donor = donorSnap.data() as Donor
    if (donor.status !== 'intact') {
      throw new Error(`Donor status is '${donor.status}', expected 'intact'.`)
    }

    const profileId = `${donor.model}-${mapDonorGradeToProfileGrade(donor.condition)}`
    const profileRef = db.collection('teardownProfiles').doc(profileId)
    const profileSnap = await tx.get(profileRef)
    if (!profileSnap.exists) {
      throw new Error(`Teardown profile not found: ${profileId}`)
    }
    const profile = profileSnap.data() as TeardownProfile

    const expectedCodes = new Set(profile.expectedParts.map((p) => p.skuCode))

    // Snapshot expectedResale from the SKU docs right here, inside the
    // transaction. This teardown never reads it again after this point —
    // a later updateSku changing expectedResale can never reach back into
    // this teardown's allocations or this transaction's stockItems.
    const skuEntries = profile.expectedParts
    const skuSnaps = await Promise.all(
      skuEntries.map(({ skuCode }) => tx.get(db.collection('skus').doc(skuCode))),
    )

    const sellable: SellablePart[] = []
    const scrapped: ScrappedPart[] = []
    const notHarvested: TeardownNotHarvestedEntry[] = []

    skuSnaps.forEach((snap, i) => {
      const { skuCode } = skuEntries[i]
      if (!snap.exists) {
        throw new Error(`SKU not found: ${skuCode}`)
      }
      const sku = snap.data() as Sku
      const submittedPart = submitted.get(skuCode)

      if (!submittedPart) {
        notHarvested.push({ partType: sku.partType, reason: '' })
      } else if (submittedPart.outcome === SELLABLE) {
        sellable.push({ skuCode, expectedResaleCents: sku.expectedResale, grade: sku.grade })
      } else {
        scrapped.push({ skuCode, grade: sku.grade, partType: sku.partType, reason: submittedPart.reason ?? '' })
      }
    })

    // A submitted part outside the profile (an unexpected but genuinely
    // harvested part) is allowed, but only for a SKU that already exists
    // and is active in the catalog — allocation needs its expectedResale,
    // and an inactive/nonexistent SKU has none to offer.
    const extraSkuCodes = [...submitted.keys()].filter((skuCode) => !expectedCodes.has(skuCode))
    const extraSkuSnaps = await Promise.all(
      extraSkuCodes.map((skuCode) => tx.get(db.collection('skus').doc(skuCode))),
    )
    extraSkuSnaps.forEach((snap, i) => {
      const skuCode = extraSkuCodes[i]
      if (!snap.exists) {
        throw new Error(`SKU not found: ${skuCode}`)
      }
      const sku = snap.data() as Sku
      if (!sku.active) {
        throw new Error(`${skuCode} is not an active SKU.`)
      }
      const submittedPart = submitted.get(skuCode)!
      if (submittedPart.outcome === SELLABLE) {
        sellable.push({ skuCode, expectedResaleCents: sku.expectedResale, grade: sku.grade })
      } else {
        scrapped.push({ skuCode, grade: sku.grade, partType: sku.partType, reason: submittedPart.reason ?? '' })
      }
    })

    if (sellable.length === 0) {
      throw new Error('At least one sellable part is required to tear down this donor.')
    }

    const allocations = allocateDonorCost(
      donor.purchaseCost,
      sellable.map((p) => ({ skuCode: p.skuCode, expectedResaleCents: p.expectedResaleCents })),
    )
    const allocatedByCode = new Map(allocations.map((a) => [a.skuCode, a.allocatedCostCents]))
    const totalExpectedResale = sellable.reduce((sum, p) => sum + p.expectedResaleCents, 0)

    const itemsCreated: string[] = []
    const allocationsTable: TeardownAllocation[] = []

    for (const part of sellable) {
      const allocatedCost = allocatedByCode.get(part.skuCode) as Cents
      const itemRef = db.collection('stockItems').doc()
      const item: WithFieldValue<StockItem> = {
        itemId: itemRef.id,
        skuCode: part.skuCode,
        donorId,
        allocatedCost,
        grade: part.grade as StockItem['grade'],
        status: 'inStock',
        location: '',
        createdAt: FieldValue.serverTimestamp(),
        soldPrice: null,
        soldDate: null,
        buyerId: '',
      }
      tx.set(itemRef, item)
      itemsCreated.push(itemRef.id)
      allocationsTable.push({
        skuCode: part.skuCode,
        expectedResale: part.expectedResaleCents,
        sharePct: part.expectedResaleCents / totalExpectedResale,
        allocatedCost,
      })

      const movementRef = db.collection('stockMovements').doc()
      const movement: WithFieldValue<StockMovement> = {
        movementId: movementRef.id,
        at: FieldValue.serverTimestamp(),
        type: 'teardownOut',
        skuCode: part.skuCode,
        itemId: itemRef.id,
        qty: 1,
        unitCost: allocatedCost,
        ref: donorId,
        brand: 'mobisource',
        note: '',
      }
      tx.set(movementRef, movement)
    }

    for (const part of scrapped) {
      const itemRef = db.collection('stockItems').doc()
      const item: WithFieldValue<StockItem> = {
        itemId: itemRef.id,
        skuCode: part.skuCode,
        donorId,
        allocatedCost: cents(0),
        grade: part.grade as StockItem['grade'],
        status: 'scrapped',
        location: '',
        createdAt: FieldValue.serverTimestamp(),
        soldPrice: null,
        soldDate: null,
        buyerId: '',
      }
      tx.set(itemRef, item)
      itemsCreated.push(itemRef.id)

      const teardownOutRef = db.collection('stockMovements').doc()
      const teardownOutMovement: WithFieldValue<StockMovement> = {
        movementId: teardownOutRef.id,
        at: FieldValue.serverTimestamp(),
        type: 'teardownOut',
        skuCode: part.skuCode,
        itemId: itemRef.id,
        qty: 1,
        unitCost: cents(0),
        ref: donorId,
        brand: 'mobisource',
        note: '',
      }
      tx.set(teardownOutRef, teardownOutMovement)

      const scrapRef = db.collection('stockMovements').doc()
      const scrapMovement: WithFieldValue<StockMovement> = {
        movementId: scrapRef.id,
        at: FieldValue.serverTimestamp(),
        type: 'scrap',
        skuCode: part.skuCode,
        itemId: itemRef.id,
        qty: -1,
        unitCost: cents(0),
        ref: donorId,
        brand: 'mobisource',
        note: part.reason,
      }
      tx.set(scrapRef, scrapMovement)
    }

    const teardownInRef = db.collection('stockMovements').doc()
    const teardownInMovement: WithFieldValue<StockMovement> = {
      movementId: teardownInRef.id,
      at: FieldValue.serverTimestamp(),
      type: 'teardownIn',
      skuCode: null,
      itemId: donorId,
      qty: -1,
      unitCost: donor.purchaseCost,
      ref: donorId,
      brand: 'mobisource',
      note: '',
    }
    tx.set(teardownInRef, teardownInMovement)

    const costCheck = allocationsTable.reduce((sum, a) => sum + a.allocatedCost, 0)

    const teardown: WithFieldValue<Teardown> = {
      teardownId: teardownRef.id,
      donorId,
      performedAt: FieldValue.serverTimestamp(),
      donorCost: donor.purchaseCost,
      allocations: allocationsTable,
      itemsCreated,
      scrapped: scrapped.map((p): TeardownScrappedEntry => ({ partType: p.partType as TeardownScrappedEntry['partType'], reason: p.reason })),
      notHarvested,
      costCheck: cents(costCheck),
    }
    tx.set(teardownRef, teardown)

    tx.update(donorRef, {
      status: 'tornDown',
      teardownId: teardownRef.id,
    })

    // Last check before the transaction commits. If this throws, every
    // tx.set/tx.update queued above is discarded — nothing above this
    // line has been sent to Firestore yet.
    assertAllocationSumsToDonorCost(
      allocationsTable.map((a) => a.allocatedCost),
      donor.purchaseCost,
    )

    return { teardownId: teardownRef.id, itemsCreated }
  })
}
