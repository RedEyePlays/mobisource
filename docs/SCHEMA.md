# MobiSource — Inventory & Teardown Schema

## 1. SKU convention

Two things need SKUs and they are **not** the same product:

```
MS-{PART}-{MODEL}-{GRADE}-{SOURCE}
```

| Segment | Values | Notes |
|---|---|---|
| PART | See table below | Keep the list short and fixed |
| MODEL | IP14P, IP15PM, S26U, FOLD8 | One canonical code per model |
| GRADE | A, B, C (pulls) / N (new) | Cosmetic + functional grade |
| SOURCE | PULL, AFT, OEM | PULL = harvested, AFT = China aftermarket, OEM = new genuine |

Examples:
- `MS-SCRN-IP14P-A-PULL` — genuine pull screen, grade A
- `MS-SCRN-IP14P-N-AFT` — new aftermarket screen (imported)
- `MS-BATT-IP14P-N-AFT` — new aftermarket battery

**Rule:** a pull and an aftermarket part never share a SKU. Different cost, different price, different buyer expectation.

### Part codes

| Code | Part | Notes |
|---|---|---|
| SCRN | Screen assembly | |
| LOGIC | Motherboard | |
| HOUSASM | Housing **assembly** — back glass, frame, charging port, NFC, speaker, buttons all still fitted | A/B donors only |
| HOUS | Bare housing / frame | |
| BGLS | Back glass | |
| BATT | Battery | Often scrap — see §6 |
| CAMR | Rear camera | |
| CAMF | Front camera | |
| CHRG | Charging port flex | C/D donors only |
| NFC | NFC flex | Model dependent |
| SPKR | Loudspeaker | Model dependent |
| EARP | Earpiece speaker | |
| PROX | Proximity / sensor flex | |
| FLSH | Flash / flashlight flex | Model dependent |
| TAPT | Taptic engine | |

`HOUSASM` vs `HOUS` + `CHRG` + `NFC` + `SPKR` is the core fork. Selling the assembly whole on a mint donor is almost always worth more than the sum of the flexes, and it's a fraction of the labour.

---

## 2. Tracking mode

Not everything needs serial-level tracking.

| Mode | Use for | Tracking |
|---|---|---|
| `serialized` | Harvested pulls, donor devices, sealed phones | One record per physical unit |
| `bulk` | Imported aftermarket parts | SKU + quantity on hand + weighted-average cost |

Serialized items carry their own allocated cost. Bulk items carry a running weighted-average landed cost.

---

## 3. Collections

### `skus` — catalog (one doc per SKU, not per unit)

```
skuCode          string    MS-SCRN-IP14P-A-PULL
partType         string    SCRN
model            string    IP14P
grade            string    A
source           string    PULL
trackingMode     string    serialized | bulk
listPriceRetail  number
listPriceTier1   number    1-4 units
listPriceTier2   number    5-19 units
listPriceTier3   number    20+ units
expectedResale   number    used for teardown cost allocation
active           bool
```

### `donors` — devices bought to tear down

```
donorId          string
model            string    IP14P
imei             string
purchaseCost     number    CAD, all-in
purchaseDate     timestamp
source           string    local | china | trade-in
supplierRef      string
condition        string    mint | good | cracked
status           string    intact | tornDown | resoldWhole
teardownId       string    set when torn down
notes            string
```

A donor can also be **resold whole** if the market moves — keep that path open.

### `stockItems` — serialized units (harvested parts, sealed phones)

```
itemId           string
skuCode          string
donorId          string    null if imported/purchased separately
allocatedCost    number    CAD — see §4
grade            string
status           string    inStock | reserved | sold | scrapped | returned
location         string    bin/shelf
createdAt        timestamp
soldPrice        number
soldDate         timestamp
buyerId          string
```

### `bulkStock` — imported aftermarket parts

```
skuCode          string    (doc id)
qtyOnHand        number
avgLandedCost    number    CAD, weighted average
lastReceivedAt   timestamp
reorderPoint     number
```

### `teardowns` — the event that converts a donor into parts

```
teardownId       string
donorId          string
performedAt      timestamp
donorCost        number    copied from donor at time of teardown
allocations      array     [{ skuCode, expectedResale, sharePct, allocatedCost }]
itemsCreated     array     [itemId]
scrapped         array     [{ partType, reason }]
costCheck        number    sum(allocatedCost) — must equal donorCost
```

### `stockMovements` — append-only ledger

Every change to stock writes a row here. Nothing edits quantity directly.

```
movementId       string
at               timestamp
type             string    receive | teardownIn | teardownOut | sale | return | scrap | adjust | transfer
skuCode          string
itemId           string    serialized only
qty              number    +/-
unitCost         number
ref              string    donorId | orderId | invoiceNo
brand            string    mobisource | flipthattech
note             string
```

### `buyers`

```
buyerId          string
name             string
type             string    repairShop | broker | exporter | retail
tier             string    tier1 | tier2 | tier3
terms            string    prepay | net7 | net15
contact          object
```

### `salesOrders`

```
orderId          string
buyerId          string
lines            array     [{ skuCode, itemId?, qty, unitPrice, unitCost }]
subtotal, tax, total
status           string    quoted | confirmed | shipped | paid
createdAt        timestamp
```

---

## 3.5 Teardown profiles

The output set depends on **model + donor grade**, not model alone. Store it as a template so teardown intake is a checklist, not a decision every time.

### `teardownProfiles`

```
profileId        string    IP14P-AB / IP14P-CD
model            string
donorGrade       string    AB | CD
expectedParts    array     [{ skuCode, likelihood }]
```

`likelihood` = how often this part actually comes out sellable (0–1). Seeds your yield expectations and gets corrected by real data.

**Profile: mint donor (A/B housing)**

| SKU | Likelihood |
|---|---|
| MS-SCRN-{model}-A-PULL | 0.9 |
| MS-LOGIC-{model}-A-PULL | 0.95 |
| MS-HOUSASM-{model}-A-PULL | 0.9 |
| MS-CAMR-{model}-A-PULL | 0.95 |
| MS-CAMF-{model}-A-PULL | 0.9 |
| MS-BATT-{model}-B-PULL | 0.3 |

**Profile: rough donor (C/D housing)**

| SKU | Likelihood |
|---|---|
| MS-SCRN-{model}-B-PULL | 0.6 |
| MS-LOGIC-{model}-A-PULL | 0.95 |
| MS-CHRG-{model}-A-PULL | 0.9 |
| MS-NFC-{model}-A-PULL | 0.8 |
| MS-SPKR-{model}-A-PULL | 0.8 |
| MS-EARP-{model}-A-PULL | 0.8 |
| MS-PROX-{model}-A-PULL | 0.7 |
| MS-FLSH-{model}-A-PULL | 0.6 |
| MS-TAPT-{model}-A-PULL | 0.8 |
| MS-CAMR-{model}-A-PULL | 0.9 |
| MS-CAMF-{model}-A-PULL | 0.9 |
| MS-BGLS-{model}-C-PULL | 0.4 |

Model-specific parts (NFC, flash, speaker count) just get left out of that model's profile. The profile is the model's parts list — no need for a universal schema that covers every phone.

---

## 4. Teardown cost allocation

Relative sales value. Each part's share of the donor cost is proportional to its expected resale.

**Allocation runs only over parts you actually harvested and intend to sell.** The profile proposes the list; you tick off what really came out. A battery you binned absorbs no cost — its share redistributes across the parts that survived, which is exactly right, because those parts have to carry the whole $400.

```
sharePct_i      = expectedResale_i / Σ expectedResale
allocatedCost_i = donorCost × sharePct_i
```

Worked example — mint iPhone 14 Pro donor at $400 CAD:

| SKU | Expected resale | Share | Allocated cost |
|---|---|---|---|
| MS-SCRN-IP14P-A-PULL | 220 | 42.3% | 169.23 |
| MS-LOGIC-IP14P-A-PULL | 120 | 23.1% | 92.31 |
| MS-CAMR-IP14P-A-PULL | 60 | 11.5% | 46.15 |
| MS-BGLS-IP14P-A-PULL | 60 | 11.5% | 46.15 |
| MS-TAPT-IP14P-A-PULL | 35 | 6.7% | 26.92 |
| MS-BATT-IP14P-A-PULL | 25 | 4.8% | 19.23 |
| **Total** | **520** | **100%** | **400.00** |

**Invariant:** `Σ allocatedCost == donorCost`. Assign the rounding remainder to the highest-value part so it always balances exactly.

`expectedResale` lives on the SKU doc, so allocation is automatic once you pick which parts came out.

---

## 5. Teardown transaction

One atomic write. If any step fails, none of it lands.

```
1. Load donor, assert status == 'intact'
1b. Load teardownProfile for (model, donorGrade) → prefill the checklist
2. Load expectedResale for each ticked part SKU
3. Compute shares and allocated costs; force sum to donorCost
4. Create N stockItems (status: inStock, allocatedCost set, donorId set)
5. Create teardown doc with the allocation table
6. Set donor.status = 'tornDown', donor.teardownId
7. Write stockMovements:
   - one teardownIn  row: donor unit out,  qty -1, cost donorCost
   - N teardownOut   rows: each part in,   qty +1, cost allocatedCost_i
8. Scrapped parts: create the item, immediately status 'scrapped'
   (so the cost is written off visibly, not silently lost)
```

Do this in a Cloud Function callable, not client-side — same server-mediated-writes pattern already on the FTT roadmap.

---

## 6. Scrap handling

Two different cases, and they need different handling:

**Not harvested / no market** (most batteries). Don't create a stockItem at all. Log it on the teardown as `notHarvested` so your likelihood numbers stay honest. It absorbs no cost.

**Harvested then broken or unsellable.** Create the stockItem, set `status: scrapped`, write a `scrap` movement. The cost hits a scrap account instead of vanishing. Your yield rate per model comes straight out of this — and yield is the number that tells you which donors to keep buying.

---

## 7. Reports that fall out of this

| Report | Source |
|---|---|
| Value on hand | Σ allocatedCost where status = inStock, + bulkStock qty × avgLandedCost |
| Margin per part SKU | soldPrice − allocatedCost, grouped by skuCode |
| Donor ROI by model | Σ soldPrice of children ÷ donorCost, grouped by donor model |
| Yield rate | scrapped items ÷ total items created, by model |
| Aging | days since createdAt where status = inStock |
| Buyer revenue | salesOrders grouped by buyerId |

**Donor ROI by model is the one that changes what you buy.** After 20 teardowns it tells you which models to chase locally and which to stop paying mint prices for.

---

## 8. Build order

1. `skus` catalog + SKU generator
2. `donors` intake (IMEI, cost, source)
3. Teardown callable + allocation
4. `stockItems` list view — filter by SKU, grade, status
5. `stockMovements` ledger (retrofit later = painful; do it now)
6. Sales orders + buyer tiers
7. Reports
