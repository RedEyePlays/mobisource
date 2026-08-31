import { FieldValue } from 'firebase-admin/firestore'
import { allocateDonorCost } from './allocateDonorCost.js'

const SELLABLE = 'sellable'
const SCRAPPED = 'scrapped'

/** donors.condition (A|B|C|D) -> teardownProfiles.donorGrade (AB|CD), per SCHEMA.md §3.5. */
export function mapDonorGradeToProfileGrade(condition) {
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
export function assertAllocationSumsToDonorCost(allocatedCosts, donorCostCents) {
  const sum = allocatedCosts.reduce((total, cost) => total + cost, 0)
  if (sum !== donorCostCents) {
    throw new Error(`Allocated costs sum to ${sum}, expected ${donorCostCents}.`)
  }
}

function validateSubmittedParts(parts) {
  if (!Array.isArray(parts)) {
    throw new Error('parts must be an array.')
  }

  const byCode = new Map()
  for (const part of parts) {
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

/**
 * Performs a teardown per SCHEMA.md §5, atomically. `db` is a Firestore
 * instance (admin SDK) so this is callable directly from tests against
 * the emulator, without going through the onCall wrapper.
 *
 * parts: [{ skuCode, outcome: 'sellable' | 'scrapped', reason? }]
 * Any of the profile's expectedParts not present in `parts` is treated as
 * notHarvested. Every submitted skuCode must belong to the profile.
 */
export async function teardownDonor(db, { donorId, parts }) {
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
    const donor = donorSnap.data()
    if (donor.status !== 'intact') {
      throw new Error(`Donor status is '${donor.status}', expected 'intact'.`)
    }

    const profileId = `${donor.model}-${mapDonorGradeToProfileGrade(donor.condition)}`
    const profileRef = db.collection('teardownProfiles').doc(profileId)
    const profileSnap = await tx.get(profileRef)
    if (!profileSnap.exists) {
      throw new Error(`Teardown profile not found: ${profileId}`)
    }
    const profile = profileSnap.data()

    const expectedCodes = new Set(profile.expectedParts.map((p) => p.skuCode))
    for (const skuCode of submitted.keys()) {
      if (!expectedCodes.has(skuCode)) {
        throw new Error(`${skuCode} is not part of profile ${profileId}.`)
      }
    }

    // Snapshot expectedResale from the SKU docs right here, inside the
    // transaction. This teardown never reads it again after this point —
    // a later updateSku changing expectedResale can never reach back into
    // this teardown's allocations or this transaction's stockItems.
    const skuEntries = profile.expectedParts
    const skuSnaps = await Promise.all(
      skuEntries.map(({ skuCode }) => tx.get(db.collection('skus').doc(skuCode))),
    )

    const sellable = []
    const scrapped = []
    const notHarvested = []

    skuSnaps.forEach((snap, i) => {
      const { skuCode } = skuEntries[i]
      if (!snap.exists) {
        throw new Error(`SKU not found: ${skuCode}`)
      }
      const sku = snap.data()
      const submittedPart = submitted.get(skuCode)

      if (!submittedPart) {
        notHarvested.push({ partType: sku.partType, reason: '' })
      } else if (submittedPart.outcome === SELLABLE) {
        sellable.push({ skuCode, expectedResaleCents: sku.expectedResale, grade: sku.grade })
      } else {
        scrapped.push({ skuCode, grade: sku.grade, partType: sku.partType, reason: submittedPart.reason })
      }
    })

    if (sellable.length === 0) {
      throw new Error('At least one sellable part is required to tear down this donor.')
    }

    const allocations = allocateDonorCost(donor.purchaseCost, sellable)
    const allocatedByCode = new Map(allocations.map((a) => [a.skuCode, a.allocatedCostCents]))
    const totalExpectedResale = sellable.reduce((sum, p) => sum + p.expectedResaleCents, 0)

    const itemsCreated = []
    const allocationsTable = []

    for (const part of sellable) {
      const allocatedCost = allocatedByCode.get(part.skuCode)
      const itemRef = db.collection('stockItems').doc()
      tx.set(itemRef, {
        itemId: itemRef.id,
        skuCode: part.skuCode,
        donorId,
        allocatedCost,
        grade: part.grade,
        status: 'inStock',
        location: '',
        createdAt: FieldValue.serverTimestamp(),
        soldPrice: null,
        soldDate: null,
        buyerId: '',
      })
      itemsCreated.push(itemRef.id)
      allocationsTable.push({
        skuCode: part.skuCode,
        expectedResale: part.expectedResaleCents,
        sharePct: part.expectedResaleCents / totalExpectedResale,
        allocatedCost,
      })

      const movementRef = db.collection('stockMovements').doc()
      tx.set(movementRef, {
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
      })
    }

    for (const part of scrapped) {
      const itemRef = db.collection('stockItems').doc()
      tx.set(itemRef, {
        itemId: itemRef.id,
        skuCode: part.skuCode,
        donorId,
        allocatedCost: 0,
        grade: part.grade,
        status: 'scrapped',
        location: '',
        createdAt: FieldValue.serverTimestamp(),
        soldPrice: null,
        soldDate: null,
        buyerId: '',
      })
      itemsCreated.push(itemRef.id)

      const teardownOutRef = db.collection('stockMovements').doc()
      tx.set(teardownOutRef, {
        movementId: teardownOutRef.id,
        at: FieldValue.serverTimestamp(),
        type: 'teardownOut',
        skuCode: part.skuCode,
        itemId: itemRef.id,
        qty: 1,
        unitCost: 0,
        ref: donorId,
        brand: 'mobisource',
        note: '',
      })

      const scrapRef = db.collection('stockMovements').doc()
      tx.set(scrapRef, {
        movementId: scrapRef.id,
        at: FieldValue.serverTimestamp(),
        type: 'scrap',
        skuCode: part.skuCode,
        itemId: itemRef.id,
        qty: -1,
        unitCost: 0,
        ref: donorId,
        brand: 'mobisource',
        note: part.reason,
      })
    }

    const teardownInRef = db.collection('stockMovements').doc()
    tx.set(teardownInRef, {
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
    })

    const costCheck = allocationsTable.reduce((sum, a) => sum + a.allocatedCost, 0)

    tx.set(teardownRef, {
      teardownId: teardownRef.id,
      donorId,
      performedAt: FieldValue.serverTimestamp(),
      donorCost: donor.purchaseCost,
      allocations: allocationsTable,
      itemsCreated,
      scrapped: scrapped.map((p) => ({ partType: p.partType, reason: p.reason })),
      notHarvested,
      costCheck,
    })

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
