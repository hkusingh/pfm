# Transfer Linking — Technical Design

## Problem

Bank statement imports produce two kinds of transfers:

1. **Tracked transfers** — money moving between two household accounts (e.g., checking → savings, credit-card autopay from checking). Both sides are imported as separate transactions, at different times, with no connection between them.
2. **Untracked transfers** — money leaving the household entirely (Zelle to a friend, external payment). Only the debit side exists.

The existing `CategoryKind.transfer` system already excludes transfers from spending totals. What's missing is the ability to link the two sides of a tracked transfer and to know, per transfer, whether its counterpart is a tracked account or an external one.

---

## Core Design: Transfer Routing Rules + TransferPair

### Two new concepts

**TransferRoute** — a saved user decision: "When I see merchant pattern X in Account A, it pairs with Account B (or is external)." Created once via a post-import prompt; applied automatically on all future imports of the same pattern in the same account.

**TransferPair** — a join record linking the debit-side transaction to the credit-side transaction once both exist in the DB.

### Why routing rules instead of pure auto-matching?

Pure amount/date matching is ambiguous (e.g., two $500 transfers on the same day). Routing rules capture the user's intent explicitly on first encounter, making all subsequent imports automatic and unambiguous.

---

## Data Model

### `TransferRoute`

```prisma
model TransferRoute {
  id                   String   @id @default(cuid())
  householdId          String
  sourceAccountId      String
  merchantMatch        String   // substring match against merchantNormalized
  counterpartAccountId String?  // null = external / untracked
  createdAt            DateTime @default(now())

  household          Household @relation(fields: [householdId], references: [id], onDelete: Cascade)
  sourceAccount      Account   @relation("RouteSource", fields: [sourceAccountId], references: [id], onDelete: Cascade)
  counterpartAccount Account?  @relation("RouteCounterpart", fields: [counterpartAccountId], references: [id], onDelete: SetNull)

  @@unique([sourceAccountId, merchantMatch])
  @@index([householdId])
}
```

### `TransferPair`

```prisma
model TransferPair {
  id         String   @id @default(cuid())
  debitTxId  String   @unique
  creditTxId String   @unique
  createdAt  DateTime @default(now())

  debitTx  Transaction @relation("DebitSide",  fields: [debitTxId],  references: [id], onDelete: Cascade)
  creditTx Transaction @relation("CreditSide", fields: [creditTxId], references: [id], onDelete: Cascade)
}
```

### `Transaction` additions

```prisma
awaitingCounterpartAccountId String?   // routing known, counterpart not yet imported
transferPairAsDebit          TransferPair? @relation("DebitSide")
transferPairAsCredit         TransferPair? @relation("CreditSide")
awaitingCounterpart          Account?  @relation("AwaitingCounterpart", fields: [awaitingCounterpartAccountId], references: [id], onDelete: SetNull)
```

---

## Import Flow

After the existing transaction insert loop, run transfer resolution in the same DB transaction:

### Step A — Apply known routing rules

For each newly imported transfer-kind transaction:
1. Look up `TransferRoute` by `(sourceAccountId, merchantNormalized contains merchantMatch)`.
2. **Rule → external:** Leave as-is.
3. **Rule → tracked account:** Call `tryLink(newTx, counterpartAccountId)`:
   - Find unlinked transfer-kind transaction in counterpart account with opposite sign, same absolute amount, `|date diff| ≤ 2 days`.
   - 1 match → create `TransferPair`.
   - 0 matches → set `awaitingCounterpartAccountId`.
   - >1 matches → add to `needsRouting` for user disambiguation.

### Step B — Resolve awaiting transactions

For each newly imported transfer-kind transaction, search all existing transactions where `awaitingCounterpartAccountId = newTx.accountId` and criteria match (opposite sign, same amount, ±2 days). If found: create `TransferPair`, clear `awaitingCounterpartAccountId`. This handles the case where Account A was imported before Account B.

### Step C — Collect unrouted transfers

Transfer-kind transactions with no matching route go into `needsRouting[]` in the import response.

---

## Post-Import UI: Route Transfers Step

If `needsRouting` is non-empty, the import result screen shows a routing step:

- Per unrouted transfer: date, merchant, amount + account dropdown (all household accounts + "External / not tracked")
- Optional suggestion chip if a candidate counterpart was found by amount matching
- On submit: `POST /households/:hid/transfer-routes` → re-runs `tryLink` immediately
- User can skip — unrouted transfers appear in a "Needs routing" tab on the Transactions page

---

## API Endpoints

```
POST   /households/:hid/transfer-pairs          { debitTxId, creditTxId }   — manual link
DELETE /households/:hid/transfer-pairs/:pairId                              — unlink
POST   /households/:hid/transfer-routes         [{ sourceAccountId, merchantMatch, counterpartAccountId }]
DELETE /households/:hid/transfer-routes/:id
```

Transaction list gains query param `hideLinked=true` — excludes the credit side of linked pairs.

---

## Transaction Response Shape (additions)

```ts
transferPair: {
  pairId: string;
  counterpartTxId: string;
  counterpartAccountId: string;
  counterpartAccountName: string;
} | null;

awaitingCounterpartAccount: { id: string; name: string } | null;
```

---

## UI Indicators (TransactionsPage)

| State | Badge |
|-------|-------|
| Linked | `↔ Primary Checking` (green pill) |
| Awaiting counterpart | `⏳ Waiting for Savings` (gray pill) |
| Unrouted | amber row, shown in "Needs routing" tab |

---

## What Does Not Change

- `TRANSFER_PATTERNS` auto-detection (still runs, still categorizes as Transfer kind)
- Dashboard and budget exclusion logic (`kind === 'transfer'` filter — covers all cases)
- `isExcluded` boolean (separate feature, unaffected)
