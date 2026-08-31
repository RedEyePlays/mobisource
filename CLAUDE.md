# CLAUDE.md — MobiSource

Internal inventory, teardown, and wholesale system for MobiSource (phone parts business, Brampton ON). Separate business and separate data from FlipThatTech — never share collections or read FTT data.

**`docs/SCHEMA.md` is the source of truth for all data shapes.** Read it before writing anything that touches Firestore. If a change contradicts it, update the doc in the same commit.

---

## Stack

- React + Vite + Tailwind, written in TypeScript with `strict: true`
- Firebase: Firestore, Auth, Cloud Functions, Hosting
- GitHub for version control, deploy workflow on push to `main`

---

## Hard rules

These are not preferences. Violating any of them is a bug, even if the feature works.

### 1. Security is enforced in Firestore rules, not the UI

Hiding a button stops nobody. Every permission is enforced at the database layer.

- Every collection has explicit rules. No `allow read, write: if true`, ever, including during development.
- Rules changes must be verified with the **rules emulator**, with tests covering both the allowed and the denied case. Reading the rules and reasoning about them is not verification — a hole has survived two manual reviews on the sibling project.
- Rules tests live in `tests/rules/` and run in CI.

### 2. Secrets never enter the browser bundle

Anything in frontend code is public. API keys, supplier credentials, and anything else sensitive go in Cloud Functions and are read from environment config.

Business-sensitive data counts too: landed costs, buyer tier pricing, and margin figures must not be fetchable by a client that isn't authorized for them. Don't ship a collection the client filters — filter server-side.

### 3. Money math has tests

Nearly every serious bug in the sibling project was a double-count or a wrong sign, and they are invisible until they aren't.

- Any function that touches cost, price, allocation, margin, or quantity gets unit tests before it gets a UI.
- Write the pure function first, test it, then wire it up.
- Test the edge cases explicitly: zero, negative, rounding remainders, single-item collections.

### 4. One source of truth per number

Duplicate calculations drift apart silently.

- `stockMovements` is the ledger. It is **append-only** — never update or delete a movement row. Corrections are new compensating rows.
- Quantities and stock values are derived from the ledger, or written only by the same transaction that writes the ledger row. Never maintained independently in two places.
- If a number can be computed, compute it. Don't cache it without a stated reason and a single writer.

### 5. All writes go through Cloud Function callables

No client-side writes to Firestore. The client calls a callable; the callable validates, writes, and appends the ledger row atomically.

---

## Invariants to assert in code

These fail loudly rather than silently:

```
Σ allocatedCost of a teardown's parts  ==  donorCost of that donor
Σ ledger qty for a SKU                 ==  its counted stock
a donor with status 'tornDown'         has exactly one teardown doc
no stockMovement row is ever mutated
```

---

## Conventions

- SKU format and part codes: see `docs/SCHEMA.md` §1
- Teardown output depends on **model + donor grade**, driven by `teardownProfiles` — never a hardcoded part list
- Allocation runs only over parts actually harvested and intended for sale (§4)
- Currency is CAD throughout. USD supplier pricing converts at the internal rate before it enters the system.
- Store money as integer cents, not floats. In code, money is the branded `Cents` type (see `functions/src/lib/types.ts` and `src/types.ts`), never a bare `number` — this makes it a type error to pass cents where dollars are expected, or vice versa.
- Timestamps are Firestore `Timestamp`, always UTC

---

## Working style

- Plan before building. When asked for a feature, describe the approach and the files you'd touch, then wait for approval.
- Small commits, one concern each.
- Don't add dependencies without asking.
- Don't scaffold features that weren't requested.
- If something in this file turns out to be wrong or unclear, say so instead of working around it.
