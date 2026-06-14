# Epic 11 — Rental Investment Tracking

> **Status:** Planned — not yet started. Commit Epic 10 first, then pick this up.

## Problem

Households that own rental properties have income and expenses structurally different from personal finances: rent received, mortgage payments, maintenance, property tax, management fees, depreciation. A landlord may not want these to pollute their personal monthly budget view — they want to see "did I spend too much on groceries?" separately from "is my rental cash-flow positive this month?".

The Settings page currently has only a Profile section. This Epic adds a **Finances** preferences section where users choose how rental activity appears across the app.

---

## Alternative Approaches

### Option A — Financial Segments *(Recommended for Phase 1)*

Add a `segment` field to the `Account` model: `personal | rental | business`. Every account belongs to exactly one segment. All views (Dashboard, Transactions, Budget) filter by the active segment.

**Settings toggle:** "Rental finances → Include in main view / Show as separate section"

When "separate section" is chosen:
- A **Rental** nav item appears in the sidebar
- Clicking it scopes the entire app to rental accounts — same pages, filtered to `segment = rental`
- Main Dashboard/Transactions exclude rental accounts entirely
- Accounts page still shows all accounts with a "Rental" segment badge

**DB change:** `segment AccountSegment @default(personal)` enum on `Account`; `rentalViewMode String @default("blended")` on `Household`  
**Migration:** Non-breaking — existing accounts default to `personal`

**Pros:** Extends to "business" finances in a future story with zero architectural change; reuses every existing component  
**Cons:** Segment is account-level — a single account can't be split between personal and rental

---

### Option B — Rental Property Entity *(Recommended for Phase 2)*

A first-class `RentalProperty` model (address, purchase price, acquisition date, units). Accounts are linked to a property (e.g., a dedicated checking account + a mortgage both belong to "123 Main St"). A dedicated **Properties** nav section shows per-property P&L, cash-on-cash return, cap rate, NOI.

**Settings toggle:** "Include rental properties in main dashboard totals: Yes / No"

**DB additions:** `RentalProperty` model; `Account.propertyId FK → RentalProperty`  
**New pages:** Property list, Property detail (income vs. expense breakdown, occupancy, investor metrics)  
**Category seed additions:** Rent Received, Property Mortgage, Maintenance & Repairs, Property Tax, Property Insurance, Property Management Fee, Depreciation

**Pros:** Richest analytics for serious landlords; investor-grade metrics  
**Cons:** Significant scope; requires new pages and models

---

### Option C — Account Portfolio Tags

Add `portfolioTag String?` to Account. User labels accounts with free-text tags ("Rental", "Business"). Settings designates which tags get a separate nav section.

**Pros:** No enum to maintain; user-defined  
**Cons:** Free text is hard to query reliably; can't enforce consistent labeling

---

### Option D — Category-Based Separation *(No schema change)*

Seed a "Rental" top-level category parent. Settings toggle shows/hides a Rental nav section filtering transactions to rental categories.

**Pros:** Zero DB migration  
**Cons:** Misses account-level data (balances, mortgage payoff); can't separate a shared account that has both personal and rental charges

---

## Recommended Path: Option A → Option B

Ship Option A (Segments) first — contained schema addition and clear Settings UX. Option B (Property entity) layers on top in a follow-up once segment infrastructure exists.

---

## Implementation Plan (Option A)

### E11.1 — DB: Account Segment + Household Preference

**File:** `packages/db/prisma/schema.prisma`
- Add enum `AccountSegment { personal rental business }`
- Add `segment AccountSegment @default(personal)` to `Account`
- Add `rentalViewMode String @default("blended")` to `Household`
- Run two migrations: `add_account_segment`, `add_household_rental_view_mode`

### E11.2 — Contracts

**File:** `packages/contracts/src/account.ts`
- Add `segment: z.enum(['personal', 'rental', 'business']).optional()` to create/update schemas
- Add `segment: z.enum(['personal', 'rental', 'business'])` to response schema

**New file:** `packages/contracts/src/preferences.ts`
- `UpdateHouseholdPreferencesSchema: { rentalViewMode: z.enum(['blended', 'separate']) }`

### E11.3 — API: Account Segment

**File:** `apps/api/src/account/account.service.ts`
- Accept and persist `segment` in `createAccount` and `updateAccount`
- Return `segment` in `toAccountResponse`

### E11.4 — API: Household Preferences Endpoint

**File:** `apps/api/src/household/household.controller.ts`
- New route: `PATCH /households/:id/preferences` — accepts `{ rentalViewMode }`, updates `Household.rentalViewMode`
- Audit log entry on change

### E11.5 — API: Segment Filtering

**Files:** `apps/api/src/transaction/transaction.service.ts`, `apps/api/src/dashboard/dashboard.service.ts`
- Accept optional `segment?: string` query param
- When present, add `account: { segment }` to Prisma `where` clauses
- Client is responsible for appending `?segment=personal` to main-view queries when `rentalViewMode = 'separate'`

### E11.6 — UI: Settings — Finances Section

**File:** `apps/web/src/pages/SettingsPage.tsx`
- Add "Finances" section below "Profile":

```
Rental investments
  ○ Include in main view
    Rental income and expenses appear alongside your personal finances.
  ● Show as separate section
    Rental gets its own Dashboard and Transactions in the nav.
    Main view shows personal finances only.
```

- On change → `PATCH /households/{id}/preferences`; invalidate household query

### E11.7 — UI: Accounts Page — Segment on Add/Edit

**File:** `apps/web/src/pages/AccountsPage.tsx`
- Segment dropdown in both add and edit forms: Personal / Rental / Business (default: Personal)
- Amber "Rental" or blue "Business" badge on non-personal account rows

### E11.8 — UI: Conditional Rental Nav + Scoped Views

**File:** `apps/web/src/components/AppShell.tsx`
- When `household.rentalViewMode === 'separate'` AND at least one rental account exists:
  - Add "Rental" nav item → `/rental` (or `/rental/dashboard`)
  - Inject `?segment=personal` into all main-view API calls
- Routes `/rental/dashboard` and `/rental/transactions` mount the same page components with `segment=rental` injected via route context or search param — no new page components needed

---

## Phase 2 Stories (Option B — Property Entity)

Once Option A ships:
- `RentalProperty` model: address, units, acquisition price, purchase date
- `Account.propertyId → RentalProperty` (nullable FK)
- `/rental/properties` page: property cards, per-property P&L
- Investor metrics computed client-side: NOI, cash-on-cash return, cap rate
- Seed rental-specific categories: Rent Received, Property Mortgage, Maintenance & Repairs, Property Tax, Property Insurance, Property Management, Depreciation

---

## File Change Summary (Option A)

| File | Change |
|------|--------|
| `packages/db/prisma/schema.prisma` | `AccountSegment` enum + `Account.segment`; `Household.rentalViewMode` |
| `packages/contracts/src/account.ts` | `segment` in create/update/response schemas |
| `packages/contracts/src/preferences.ts` | New — `UpdateHouseholdPreferencesSchema` |
| `apps/api/src/account/account.service.ts` | Persist + return `segment` |
| `apps/api/src/household/household.controller.ts` | New `PATCH /preferences` route |
| `apps/api/src/transaction/transaction.service.ts` | Accept + apply `segment` filter |
| `apps/api/src/dashboard/dashboard.service.ts` | Accept + apply `segment` filter |
| `apps/web/src/pages/SettingsPage.tsx` | "Finances" section with rental view toggle |
| `apps/web/src/pages/AccountsPage.tsx` | Segment dropdown in add/edit; segment badge on rows |
| `apps/web/src/components/AppShell.tsx` | Conditional Rental nav item; `segment=personal` injected in main queries |

---

## Verification

1. Add an account with segment "Rental" → amber "Rental" badge appears on account row
2. Settings → Finances → "Show as separate section" → "Rental" nav item appears in sidebar
3. Rental Dashboard shows only rental account totals and rental transactions
4. Main Dashboard excludes rental balances and transactions entirely
5. Switch back to "Include in main view" → Rental nav disappears; rental data returns to main views
6. `pnpm typecheck && pnpm lint` pass clean
