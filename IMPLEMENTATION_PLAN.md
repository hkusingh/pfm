# Personal Finance Manager — Phase 1 Implementation Plan

**Audience:** Claude Code (VS Code) and the engineers driving it.
**Purpose:** Turn the Phase 1 PRD and epic breakdown into a concrete, buildable plan — stack,
repo layout, shared contracts, and an ordered set of stories→tasks with the files to create and the
acceptance bar for each.
**Source of truth:** `docs/phase1-spec.md` (PRD), `docs/phase1-technical-design.html` (tech design),
`docs/phase1-epics-and-stories.md` (epics). This plan operationalizes them; it does not override them.

---

## Status & Next Up  *(read this first)*

**Last updated:** 2026-06-10.

**Done:**
- **Epic 0 — Foundation / Shared Kernel** ✅ — monorepo scaffold, data model + migrations, auth
  (signup/login/email verify/password reset), mandatory MFA (TOTP + recovery codes), visibility scope
  helper, design system (`@pfm/ui`), API conventions (envelope, Zod validation, global guards), privacy
  endpoints (data export + deletion). Merged to `main`.
- **Epic 8 — Platform Access & Site Admin** ✅ (E8.1–E8.4) — invitation-only signup enforced
  server-side, `RegistrationPolicy` toggle (`admin_invite` | `beta_invite` | `open`), site-admin role
  + seed (`hksingh@gmail.com`), admin UI at `/admin` (invite management, user list, policy toggle).
  `householdInviteQuota` field on `RegistrationPolicy` (default 5); `beta_invite` requires valid
  invite token; `open` allows free signup; quota exposed in policy API + admin UI.
- **Epic 1 — Household & Membership** ✅ (E1.1–E1.5) — household CRUD, member management, invite
  flow. Merged to `main`.
- **Epic 2 — Accounts & Manual Entry** ✅ (E2.1–E2.4) — manual account CRUD, per-account
  visibility, transaction CRUD with dedup hash, balance sync. Merged to `main`.

**Build right now (Wave 2 — remaining):**

1. **Epic 4 — Categories** (E4.1–E4.6) — depends on E1 ✅.

**Then:** Wave 3 (Epic 3 Import — high priority, Epic 5 Transactions, Epic 6 Budgets, Epic 9 BYOK AI)
→ Wave 4 (Epic 7 Dashboard).

**Deployment posture:** **local-first.** Develop and validate on your machine with seed/real data. Do
**not** stand up a persistent hosted environment yet — see §5.2 for the local-first → smoke-deploy →
continuous-deploy sequence and the local↔hosted parity rules to follow while building.

**Recent decisions captured below:** local-first deployment + GCP/Neon rationale (§5.1–5.2);
invitation-only access policy (§8); user-provided (BYOK) AI credentials, pulled into Phase 1 (§9);
E8.4 household quota = 5 pending invites, refreshes on acceptance. The PRD and roadmap have been
reconciled to match.

---

## 0. Decisions & rationale

| Decision | Choice | Why |
|---|---|---|
| Language | TypeScript everywhere | One language across API, web, future mobile (RN/Expo) and chat agent; share types/validation. |
| Backend shape | **Standalone API** (not coupled to the web app) | Mobile app and chat agent are first-class future clients of the same API. The web app is just the first client. |
| API framework | NestJS | Module-per-epic maps cleanly to parallel teams; guards/interceptors are a natural home for auth + visibility enforcement. |
| Monorepo | pnpm workspaces + Turborepo | Shared `contracts`/`core`/`db` packages consumed by every app; one install, cached builds. |
| DB / ORM | **Neon Postgres** (managed, serverless) + Prisma | Relational integrity for money/household data; typed client; checked-in migrations; pooled serverless connections; DB branching for preview/CI envs. |
| Hosting | **Google Cloud Run** (containers) | Serverless containers, scales to zero, HTTPS out of the box; runs the standalone NestJS server cleanly (unlike Vercel serverless); the same image is portable off GCP. |
| Contracts | Zod in `packages/contracts` | Single schema validated on the server and imported (inferred types) by all clients — contracts can't drift. |
| Domain logic | `packages/core` (framework-agnostic) | Visibility scope, dedup, amortization math reused by API, workers, and the future agent. |
| Web | Vite + React + TanStack Query + Tailwind + Recharts | Pure API client, mirrors how mobile will consume the API; Recharts per the feature breakdown. |
| Jobs | **Phase 1: inline; Phase 2: Cloud Tasks / Pub-Sub → Cloud Run** | Phase 1 import parsing is small enough to run inline; async fan-out (and Plaid sync) arrives in Phase 2 as request-driven Cloud Run jobs behind a queue interface. No Redis/BullMQ in Phase 1. |
| Money | Integer minor units (cents) + currency | No float drift in financial math. |
| Currencies | **USD / EUR / GBP / INR**; per-account currency; **no FX conversion** | Accounts shown natively; base-currency roll-ups only; mixed currencies never blended. See §2.1 "Currency handling". |
| Profile | Signup captures **name** (+ email/password); **DoB optional** (profile) | Name needed for member list/greeting; DoB optional PII, not required. Role is on `Membership`, not `User`. |
| Access policy | **Invitation-only** (`admin_invite` → `beta_invite` → `open`) | Phase 1 is a closed test: only people the site admin invites can create an account. Beta opens household-to-household invites; GA opens signup. A policy toggle, not a rewrite. See §8. |
| AI (Phase 1 slice) | **BYOK** — user supplies their own Claude/OpenAI/Gemini key | Provider-agnostic LLM used to interpret/categorize expenses. Offloads cost + vendor choice during the test; always optional and feature-flagged. See §9. |
| Deployment | **Local-first**, then serverless when there are testers | Validate locally with real/mock data; avoid paying for idle infra. GCP Cloud Run + Neon idle near-zero when the time comes. See §5.2. |

**Scope reminders:** Phase 1 = invitation-only, limited-user test. Data path is **document upload +
manual entry only**. **Plaid is Phase 2** (data model leaves seams; we don't build it). The only
user-facing AI in Phase 1 is the **optional BYOK categorization** slice (§9); the full AI insights
platform (forecasting, coaching, anomalies, conversational agent) remains Phase 2.

**Product name is deferred — keep it out of the code.** `pfm` / `@pfm/*` is the working name and stays
that way; the real brand name is chosen later, after parts of the app exist. The user-facing app title
lives in **exactly one place** — a single `APP_NAME` constant (sourced from env, e.g. `PUBLIC_APP_NAME`,
in `packages/config`) that the web UI reads. Do **not** hardcode a product/brand name anywhere else
(page titles, emails, headers, copy, package names, repo). Renaming later must be a one-line change, not
a find-and-replace.

---

## 1. Monorepo layout (target)

```
pfm/
  apps/
    api/        # NestJS — modules: auth, mfa, household, accounts, import, categories,
                #          transactions, budgets, dashboard, audit. Containerized → Cloud Run.
    web/        # Vite React SPA (static build → Cloud Storage + Cloud CDN, or any static host)
    # worker/   # (Phase 2) async processors (Plaid sync, heavy enrichment) — Cloud Run job
                #          triggered by Cloud Tasks/Pub-Sub. Phase 1 processes imports inline in api.
  packages/
    contracts/  # Zod schemas + inferred types, per domain (auth, household, accounts, ...)
    db/         # Prisma schema, migrations, generated client, seed
    core/       # visibility scope, dedup hash, amortization, money utils, dates/periods,
                #   object-store + queue interfaces
    ai/         # provider-agnostic LlmProvider interface + Anthropic/OpenAI/Google adapters (BYOK, §9)
    ui/         # design tokens + base components + chart wrappers
    config/     # eslint / tsconfig / tailwind / vitest presets
    testing/    # test-data factories + leakage-matrix harness + clock/RNG/SMTP/object-store stubs
  docs/         # existing planning docs (source of truth)
  docker-compose.yml   # postgres for local dev (redis only when the Phase 2 worker lands)
  Dockerfile(s)        # per deployable app — the unit of deploy to Cloud Run
  turbo.json, pnpm-workspace.yaml, package.json
```

Package names: `@pfm/api`, `@pfm/web`, `@pfm/contracts`, `@pfm/db`, `@pfm/core`, `@pfm/ai`,
`@pfm/ui`, `@pfm/config`, `@pfm/testing` (Phase 1) · `@pfm/worker` (Phase 2).

Each deployable app ships a **Dockerfile** (Next-free; `api` builds a Node server image, `web` a static
bundle). The container is the unit of deploy — this is the portability seam that keeps us off any single
host's lock-in.

---

## 2. Shared contracts (define in Epic 0, treat as stable)

### 2.1 Data model (Prisma — entities & key fields)

Build these in `packages/db`. Names are guidance; keep the relationships and the marked constraints.

- **User** — `id`, `email` (unique), `passwordHash`, `name` (display name, captured at signup),
  `dateOfBirth?` (**optional**, nullable — profile field, not required at signup; sensitive PII, store
  encrypted/min-exposure and only surface where needed), `emailVerifiedAt`, `isSiteAdmin` (bool, default
  false — **platform** operator role, distinct from household roles), `locale?`, `timezone?`, timestamps.
- **MfaMethod** — `id`, `userId`, `type` (`totp` | `email`), `secret` (encrypted), `isPrimary`,
  `confirmedAt`. Plus `RecoveryCode` (`userId`, `codeHash`, `usedAt`).
- **Household** — `id`, `name`, `baseCurrency` (one of `USD` | `EUR` | `GBP` | `INR`), `monthStartDay`
  (default 1).
- **RegistrationPolicy** *(singleton/global setting)* — `mode` (`admin_invite` | `beta_invite` |
  `open`), `updatedByUserId`, `updatedAt`. Phase 1 default: `admin_invite`. See §8.
- **SignupInvite** *(platform allowlist — "may create an account at all")* — `id`, `email`, `token`
  (unique), `status` (`pending`|`accepted`|`revoked`|`expired`), `expiresAt`, `issuedByUserId?`
  (site admin), `issuedByHouseholdId?` (beta households, Phase 2), `acceptedUserId?`. **Distinct from
  `Invite`**, which means "join an existing household as a member."
- **AiCredential** *(BYOK, §9)* — `id`, `householdId`, `provider` (`anthropic`|`openai`|`google`),
  `encryptedKey` (KMS-envelope ciphertext — never plaintext, never returned to client), `keyLast4`,
  `addedByUserId`, `status` (`active`|`invalid`|`revoked`), `lastValidatedAt`.
- **AiConsent** — `id`, `householdId`, `consentedByUserId`, `scope` (e.g. `categorization`),
  `grantedAt`, `revokedAt?`. Required before any transaction data is sent to a provider.
- **Membership** — join entity: `id`, `householdId`, `userId`, `role` (`owner` | `member`),
  `isPrimaryOwner` (bool — the founder; non-removable), `status`, `joinedAt`. *(Membership is
  many-to-many on purpose so multi-household is a later constraint relaxation, not a re-architecture.
  Phase 1 enforces one active household per user.)*
  - **Role mapping** (product term ↔ data): **Owner** = `role:owner` + `isPrimaryOwner:true` (founder,
    can't be removed/demoted while sole owner); **Co-owner** = `role:owner` + `isPrimaryOwner:false`
    (same powers, removable); **Member** = `role:member`. Role is set at household creation (founder →
    owner) or at invite time (co-owner/member) — it is **not** a field on `User`/captured at signup.
- **Invite** — `id`, `householdId`, `email`, `role`, `token` (unique), `expiresAt`, `status`
  (`pending`|`accepted`|`revoked`), `invitedByUserId`.
- **Account** — `id`, `householdId`, `ownerUserId`, `name`, `type`, `source`
  (`manual` | `import`; `plaid` reserved for Phase 2), `institution`, `mask`, `balanceMinor`,
  `currency` (`USD`|`EUR`|`GBP`|`INR`; defaults to household `baseCurrency`),
  `visibility` (`shared` | `private` | `balance_only`). **Scoped to household + owner.**
- **Transaction** — `id`, `accountId`, `postedDate`, `merchant`, `merchantNormalized`, `amountMinor`,
  `currency`, `categoryId?`, `dedupHash` (unique per account), `sinkingFundId?`,
  `isReserveFunded` (bool), `importBatchId?`, `tag?` (nullable, reserved for Phase 2).
- **Category** — `id`, `householdId`, `parentId?` (self-referential), `name`, `color`, `sortOrder`,
  `isSystem` (e.g. Income — protected), `kind` (`expense` | `income`).
- **CategoryRule** — `id`, `householdId`, `merchantMatch`, `categoryId`, `createdByUserId`.
- **Budget** — `id`, `householdId`, `categoryId`, `period` (month key, e.g. `2026-06`), `amountMinor`.
- **SinkingFund** — `id`, `householdId`, `categoryId`, `cadence` (`annual`|`semi`|`quarterly`),
  `totalMinor`, `nextDueDate`, `method` (`amortized`|`actual`), `reserveBalanceMinor`, `startMode`
  (`gradual`|`frontload`).
- **ImportBatch** + **ImportFile** — `id`, `accountId?`, `uploaderUserId`, `storageKey` (encrypted
  object store), `sourceFingerprint` (for remembered column mapping), `importedCount`, `skippedCount`,
  `status`.
- **ColumnMapping** — `id`, `householdId`, `sourceFingerprint`, `mapping` (json: date/merchant/amount).
- **AuditLog** — `id`, `householdId`, `actorUserId`, `action`, `targetType`, `targetId`, `metadata`,
  `createdAt`.
- **Session / RefreshToken** — `id`, `userId`, `tokenHash`, `expiresAt`, `revokedAt`.

**Currency handling (Phase 1 — per-account, NO conversion).** Supported currencies: **USD, EUR, GBP,
INR** (all 2-decimal minor units, so the integer-cents money model needs no special-casing). Each
household has a `baseCurrency`; each account has its own `currency` (may differ from base). **Amounts
are never converted — there is no FX in Phase 1.** Therefore:

- Budgets, budget-vs-actual, and blended household/dashboard **roll-up totals are computed in the
  household base currency and include only base-currency accounts/transactions.**
- Accounts and transactions in a **non-base** currency are shown **natively** in their own lists and in
  a **per-currency breakdown** on the dashboard; they are **excluded from base-currency roll-ups** — no
  silent conversion or blending of different currencies into one number.
- Display formatting is locale-aware (`Intl.NumberFormat`; e.g. `en-IN` for INR lakh/crore grouping).
- FX conversion to a single base is explicitly **deferred** (a later-phase feature needing a rates
  provider).

### 2.2 Visibility scope (the critical contract — Epic 0.5)

A single helper in `@pfm/core`. Every repository method that reads account/transaction/balance data
takes a `Scope` as a **required** parameter; totals are computed from the same scope.

```ts
type Visibility = 'shared' | 'private' | 'balance_only';

interface Scope {
  viewerUserId: string;
  householdId: string;
  mode: 'household' | 'personal';           // dashboard toggle
  // accounts the viewer may see line items for:
  lineItemAccountIds: Set<string>;
  // accounts whose balance counts toward totals but line items are hidden:
  balanceOnlyAccountIds: Set<string>;
}

function resolveScope(viewerUserId, householdId, mode): Promise<Scope>;
```

Rules: an owner always sees their own accounts fully. `shared` → visible to the household (line items +
balance). `private` → only the owner. `balance_only` → balance rolls into household totals, line items
hidden from others. Personal mode = viewer's own accounts only. **Unit tests must prove no
cross-member leakage for each state.**

### 2.3 API conventions (Epic 0.7)

- Response envelope: `{ "data": T } | { "error": { code, message, details? } }`.
- List endpoints: cursor pagination `{ data, meta: { nextCursor } }`.
- Validation: every request body/query parsed by its Zod schema; 422 on failure with `details`.
- Auth: `Authorization: Bearer <accessToken>`; refresh-token rotation endpoint; global auth guard with
  explicit `@Public()` opt-out.
- All money fields are integer minor units + a currency code.

---

## 3. Build sequence (waves)

| Wave | Epics | Gate |
|---|---|---|
| **1** | Epic 0 — Foundation ✅ | Merged to `main`. |
| **2** | Epic 8 ✅ (E8.1–E8.3 merged; E8.4 pending-small) · **Epic 1 (Household) · Epic 2 (Accounts) · Epic 4 (Categories)** | Epic 1 is the current gate — accounts and categories depend on it. |
| **3** | Epic 3 (Import — **high priority**), Epic 5 (Transactions), Epic 6 (Budgets), **Epic 9 (BYOK AI)** | Stub upstream where needed. |
| **4** | Epic 7 (Dashboard) | Integrates transactions + budgets; lands last. |

The rest of this section is the per-epic task list. Each story cites its PRD requirement and lists the
concrete work and the acceptance bar. Sizes (S/M/L) carry over from the epic doc.

---

### Epic 0 — Foundation / Shared Kernel  *(Wave 1 — must merge first)*

**E0.1 Scaffolding & CI/CD** *(M)*
- Init pnpm + Turborepo; create all `apps/*` and `packages/*` shells; shared `config` presets.
- `docker-compose.yml` (Postgres only for Phase 1); per-app `Dockerfile`; root scripts (`dev`, `build`,
  `lint`, `typecheck`, `test`).
- CI (GitHub Actions): lint + typecheck + test on PR; protect `main`. Deploy job builds the `api` image,
  pushes to **Artifact Registry**, and deploys to **Cloud Run**; `web` static build publishes to Cloud
  Storage. A Neon DB branch backs the staging/preview environment.
- **Done when:** `docker compose up -d && pnpm install && pnpm dev` boots api + web locally, and a push
  to `main` deploys the api container to Cloud Run.

**E0.2 Data model & migrations** *(L)* — PRD: Tech Design §2
- Implement the §2.1 schema in `packages/db`; initial migration; `dedupHash` + nullable `tag`;
  account scoped to `householdId` + `ownerUserId`; self-referential category.
- Seed script scaffold (categories seeded in E4.1).
- **Done when:** migrations apply cleanly; Prisma client generated and exported from `@pfm/db`.

**E0.3 Authentication** *(M)* — PRD: S-1, S-3
- Email/password/**name** signup, `argon2` hashing, email verification, login, JWT access + refresh with
  rotation and inactivity expiry. Contracts in `@pfm/contracts/auth`. (`dateOfBirth` is an optional
  profile field edited later, not collected at signup.)
- **Done when:** a verified user can log in and refresh; expired/invalid tokens rejected; tests cover it.

**E0.4 Mandatory MFA** *(L)* — PRD: S-2
- TOTP (`otplib`) + email-code methods; primary + backup; recovery codes shown once; enrollment
  enforced in onboarding before app access; rate-limit/lockout on failures; recovery via backup/codes.
- Enforcement runs behind `AUTH_GATE` (the `MfaEnrolledGuard` short-circuits when the gate is off, for
  local dev). The guard and enrollment code always exist; the gate only toggles whether they apply.
- **Done when:** unauthenticated-but-unenrolled users are routed to MFA setup; cannot reach app data
  without it; cannot disable MFA.

**E0.5 Authorization & visibility helper** *(L)* — PRD: A-4, NFR-2 — **highest-risk story**
- Implement `resolveScope` + a Nest guard/interceptor; repository base requires `Scope`; total
  computations use scope.
- **Done when:** leakage unit tests pass for shared/private/balance-only in household and personal mode;
  no repo path reads account/txn data without a scope (lint/architecture test enforces it).

**E0.6 Design system** *(M)* — PRD: NFR-1, NFR-6
- `@pfm/ui`: tokens, nav shell, cards, tables, forms, buttons, Recharts chart wrapper; responsive +
  a11y baseline (keyboard nav, contrast, labels).

**E0.7 API conventions & gateway** *(S)*
- Error/validation envelope, pagination, auth middleware, rate limiting; documented for all teams.

**E0.8 Privacy: data export & deletion (foundational)** *(S)* — PRD: S-5, NFR-3
- User can export their own data and request account/data deletion; deletion of a member detaches (not
  deletes) their connected accounts per H-5; export/deletion actions are audited.
- **Done when:** an authenticated user can trigger an export and a deletion request; both write AuditLog.

---

### Epic 1 — Household & Membership  *(Wave 2)*  — depends on E0

- **E1.1 Create household on signup** *(S, H-1)* — first user = **Owner** (`role:owner` +
  `isPrimaryOwner:true`); household has name, base currency (USD/EUR/GBP/INR), month-start.
- **E1.2 Invite member with role** *(M, H-2/H-4)* — invite by email + role; unique expiring link;
  pending invites listed; resend/revoke.
- **E1.3 Accept invite & join** *(M, H-3)* — invitee creates own login (+MFA), joins, sees shared view
  per permissions; existing email → link to household after confirmation (one active household/user).
- **E1.4 Manage roles & remove member** *(M, H-4/H-5)* — change role (owner↔member; "co-owner" =
  `role:owner` non-primary); remove (access revoked immediately; their accounts **detached not
  deleted**); **cannot remove/demote the primary owner** while they're the sole owner.
- **E1.5 Household settings** *(S, H-1)* — edit name/currency/month-start; member list with roles +
  last login. *(Member/role/visibility changes write AuditLog.)*

### Epic 2 — Accounts & Manual Entry  *(Wave 2)*  — depends on E0

- **E2.1 Account model** *(M, A-1/A-2)* — account scoped to household+owner; sources `manual`/`import`
  (Plaid reserved Phase 2); balance/institution/mask; **per-account `currency`** (USD/EUR/GBP/INR,
  defaults to household base; no conversion — see §2.1 Currency handling).
- **E2.2 Manual account & transactions** *(M, A-2)* — add manual account; add/edit transactions by hand.
- **E2.3 Per-account visibility** *(M, A-3)* — owner sets shared/private/balance-only; only owner can
  change; enforced via E0.5; defaults joint→shared, individual→private.
- **E2.4 De-duplication** *(M, A-4)* — `dedupHash` = account+date+amount+normalized-merchant; skip
  duplicates across repeat imports; never double-count.
- **Phase 2 (do not build):** E2.P2a–d Plaid link/sync/health/joint-dedup — keep model seams only.

### Epic 4 — Categories & Sub-categories  *(Wave 2)*  — depends on E0

- **E4.1 Default categories seed** *(S, C-1)* — sensible defaults per household; protected Income.
- **E4.2 Manage categories** *(M, C-2)* — add/rename/recolor/reorder/delete; reachable from
  Budgets → Manage categories; system categories protected.
- **E4.3 Sub-categories** *(M, C-3)* — nest under parent; roll up (parent = subs + direct spend);
  collapsed by default in UI.
- **E4.4 Income sub-categories** *(M, C-4)* — income subs; tracked received vs expected (not a cap);
  visibility-aware (balance-only rolls into totals without line items).
- **E4.5 Safe deletion** *(M, C-5)* — deleting a category with transactions prompts reassign/merge;
  never orphan; parent-with-children prompts child handling first.
- **E4.6 Recategorize & rules** *(M, C-6)* — change a transaction's category; optional merchant rule
  auto-applied going forward (shared logic with E5.2).

### Epic 3 — Document Upload & Import  *(Wave 3 — high priority, the Phase 1 data path)*  — depends on E2

- **E3.1 Upload & parse** *(M, A-1)* — accept CSV/OFX/QFX to **encrypted** store (GCS); parse rows;
  report row count. (PDF parsing out of scope.) Parsing runs **inline in the import service** for Phase 1
  (statement files are small); the parse/enrich step moves to an async Cloud Run job (behind the queue
  interface) in Phase 2 if/when volume warrants.
- **E3.2 Account detection & selection** *(M, A-1)* — detect account from header (mask/institution);
  pre-select target; allow new manual account; **must pick if unmatched** (no silent assignment); each
  file maps to exactly one account; multi-account file → prompt to split/import matching only.
- **E3.3 Column mapping** *(M, A-1)* — map columns → Date/Merchant/Amount; remember mapping per
  `sourceFingerprint` for repeat imports.
- **E3.4 Enrich, dedup & commit** *(M, A-1)* — enrich/auto-categorize rows; skip dupes via `dedupHash`;
  commit; report imported/skipped counts.

### Epic 5 — Transactions  *(Wave 3)*  — depends on E2, E4

- **E5.1 Transaction list** *(M, D-4)* — visibility-scoped list across accessible accounts; search +
  filter (date/account/category); pagination.
- **E5.2 Recategorize from list** *(S, C-6/D-4)* — inline recategorize; optional rule creation (shares
  logic with E4.6).
- **E5.3 Reserve-funded payment marking** *(M, B-6 — depends on E6.3)* — a txn matching a sinking-fund
  item is linked + badged ("annual · from reserve"); auto-detected with user confirm/override.

### Epic 6 — Budgets & Sinking Funds  *(Wave 3)*  — depends on E4

- **E6.1 Monthly budgets** *(M, B-1)* — set budget per category/sub-category; spent vs remaining for
  current period; sub-budgets roll up.
- **E6.2 Budget visualization** *(M, B-2)* — bars show magnitude (length ∝ budget) and utilization
  (fill = spent); near-limit/over states; sub-categories collapsed by default.
- **E6.3 Sinking funds (amortized)** *(L, B-3/B-5)* — mark recurring non-monthly expense as amortized;
  **virtual reserve** accrues monthly; actual payment draws from reserve (no budget spike); reserve
  progress (saved vs target, next due, behind/ahead); monthly view amortized, yearly view true total;
  method selectable (amortized default vs actual); mid-year start defaults to gradual; shortfall flagged
  if reserve insufficient. Amortization math lives in `@pfm/core`. **Virtual reserves only.**
- **E6.4 Income tracking** *(S, B-4)* — received vs expected per income (sub-)category; not a spend cap.
- **Phase 2 (do not build):** B-7 Actual/Smoothed toggle.

### Epic 7 — Dashboard & Reports  *(Wave 4 — lands last)*  — depends on E5, E6

- **E7.1 Dashboard KPIs & view toggle** *(M, D-1/D-2)* — KPIs (income, spending, budget remaining);
  budget vs actual; household/personal toggle (personal = own accounts only; household respects
  visibility).
- **E7.2 Default charts** *(M, D-3)* — spending by category; spending over time (**6-month default**,
  3M/6M toggle); income vs expenses; budget vs actual; interactive (hover amounts); visibility-aware;
  show **actuals**. **Currency-aware:** roll-ups are base-currency only; non-base-currency accounts
  appear in a separate per-currency breakdown, never blended (§2.1).
- **E7.3 Reserve-funded marking on spending-over-time** *(S, B-6)* — in the Actual view, the
  reserve-funded portion of a month is a distinct labeled segment so the spike is self-explaining.
- **E7.4 Period comparison report** *(M, D-5)* — compare spending **by category** across two periods,
  granularity selectable **month/quarter/year over prior or year-ago**; per-category totals + absolute/%
  change + total row; expand to sub-categories; visibility- and currency-aware (base-currency roll-ups);
  savable to dashboard. Period math (period boundaries, prior/year-ago resolution) lives in `@pfm/core`.
- **Phase 2 (do not build):** custom chart **builder**, net worth charts, rental cash-flow report. (E7.4
  is a fixed report, not the builder.)

### Epic 8 — Platform Access & Site Admin  *(Wave 2 — **E8.1–E8.3 ✅ merged to main**)*  — depends on E0

**Goal:** Phase 1 is **invitation-only**. Only people the site admin invites can create an account.
The mechanism is a policy toggle that later opens to beta (household-to-household invites) and then GA.
**This is platform-level access, distinct from household member invites (Epic 1).**

- **E8.1 Registration policy + gated signup** ✅ — `RegistrationPolicy.mode` singleton in DB
  (`admin_invite` | `beta_invite` | `open`, default `admin_invite`). Signup endpoint enforces the
  active policy server-side; invite token consumed on success. `SignupInvite` model with
  `issuedByAdminId`, `issuedByHouseholdId?`, `expiresAt`, `usedAt`. Enforcement (invite check + email
  verification) is behind `AUTH_GATE`: off in local dev → signup skips the invite/policy check and
  auto-verifies email. Always-on code; gate only toggles it. **Must be on in prod/CI.**
- **E8.2 Site-admin role + bootstrap** ✅ — `User.isSiteAdmin`; `SiteAdminGuard`; seed promotes
  `hksingh@gmail.com` to site admin on first run.
- **E8.3 Admin area** ✅ — `/admin/*` (React, guarded by `AdminLayout` + `SiteAdminGuard`): invite
  management (send/resend/revoke), user list, registration-policy toggle. Dashboard shows "Admin" nav
  link for site admins only.
- **E8.4 Beta & GA policy switches** *(S — pending)* — `beta_invite` lets an existing household issue
  signup-invites with a quota; `open` requires no invite.
  - **Quota decision:** 5 pending invites per household (`usedAt IS NULL AND expiresAt > now`); slot
    reopens on acceptance or expiry. Store as `RegistrationPolicy.householdInviteQuota Int @default(5)`.
  - **Work remaining:** (a) schema migration adding `householdInviteQuota`; (b) fix
    `AuthService.signup()` — `open` skips invite check, `beta_invite` validates household-issued invite;
    (c) expose + edit quota in `GET/PATCH /admin/registration-policy` and PolicyPage UI;
    (d) enforce quota at household invite creation (wired in Epic 1 when household invite endpoint exists).
  - Note: `SignupInvite.issuedByAdminId` is currently required — make it nullable for household-issued
    invites, or rely on `issuedByHouseholdId` presence.

### Epic 9 — BYOK AI Categorization  *(NEW · Wave 3 — build with Epics 3/5/6)*  — depends on E2, E4

**Goal:** let a household supply **their own** AI provider key (Claude / OpenAI / Gemini) and use that
LLM to interpret/categorize expenses. **Always optional, feature-flagged, and never a hard dependency**
— the app works fully with no key configured (falls back to rules/uncategorized). This pulls a thin AI
slice into Phase 1; the broader AI platform remains Phase 2.

- **E9.1 Provider-agnostic LLM layer** *(M, PRD: AI-1)* — `@pfm/ai` with an `LlmProvider` interface
  (`categorizeTransaction`, `interpretExpense`) and adapters for Anthropic, OpenAI, Google. No provider
  SDK leaks past the interface.
- **E9.2 BYOK credential management** *(M, PRD: AI-2 · highest-risk story in this epic)* — store the key
  with **GCP KMS envelope encryption** (ciphertext in `AiCredential`, decrypt in-memory at call time
  only); validate the key with a cheap test call on save; write-only (surface only provider + last-4 +
  status); rotate/revoke. Key scope is **per-household**, set by an owner, recording who added it.
- **E9.3 Consent + data minimization** *(S, PRD: AI-3, NFR-3)* — explicit, revocable `AiConsent`
  required before any data leaves the system; send only the **normalized merchant** (+ amount) — never
  account numbers, masks, or member identity. Disclose the provider in the consent copy.
- **E9.4 Categorization integration + rule caching** *(M, PRD: AI-1)* — on import (extends E3.4) and as
  a "suggest category" action (extends E4.6/E5.2), call the user's LLM to suggest a category; user
  confirms. On confirm, write a `CategoryRule` so the same merchant is never sent to the LLM twice
  (cache + cost control). Graceful fallback on missing key / provider error.

---

## 4. API surface (representative — finalize per epic in `@pfm/contracts`)

```
POST   /auth/signup            POST /auth/verify-email      POST /auth/login
POST   /auth/refresh           POST /auth/logout
POST   /mfa/setup              POST /mfa/verify             POST /mfa/recovery-codes
GET    /household              PATCH /household             GET  /household/members
POST   /household/invites      POST /invites/accept         PATCH/DELETE /household/members/:id
GET    /accounts              POST /accounts                PATCH /accounts/:id
PATCH  /accounts/:id/visibility
POST   /imports               POST /imports/:id/mapping     POST /imports/:id/commit
GET    /categories           POST /categories              PATCH/DELETE /categories/:id
GET    /transactions         PATCH /transactions/:id        POST /transactions
GET    /budgets              PUT  /budgets                  GET /sinking-funds  POST /sinking-funds
GET    /dashboard            GET  /reports/charts
# Platform access (Epic 8) — site-admin-only except where noted:
GET    /admin/signup-invites  POST /admin/signup-invites    POST /admin/signup-invites/:id/revoke
GET    /admin/registration-policy   PATCH /admin/registration-policy   GET /admin/users
# (public) signup consumes a SignupInvite token when policy = admin_invite/beta_invite
# AI / BYOK (Epic 9) — household-scoped, owner-managed:
GET    /ai/settings          PUT  /ai/credential            DELETE /ai/credential   POST /ai/credential/test
POST   /ai/consent           DELETE /ai/consent             POST /transactions/:id/suggest-category
```

Every account/transaction/dashboard endpoint resolves a `Scope` and passes it to the data layer.
Admin endpoints require `isSiteAdmin` + MFA. AI key values are never returned by any endpoint.

---

## 5. Environment & configuration

`.env.example` (commit it; never commit real `.env`):

```
DATABASE_URL=postgresql://...            # Neon (use the pooled connection string)
DATABASE_URL_TEST=postgresql://...       # dedicated pfm_test database for integration tests
JWT_ACCESS_SECRET=        JWT_REFRESH_SECRET=        ENCRYPTION_KEY=   # for at-rest field/file encryption
SMTP_URL=                                # email verification + MFA email codes
STORAGE_DRIVER=local|gcs   GCS_BUCKET=   GOOGLE_APPLICATION_CREDENTIALS=   # statement-file storage
KMS_KEY_RESOURCE=                        # GCP KMS key for BYOK AI envelope encryption (Epic 9)
REGISTRATION_POLICY=admin_invite         # bootstrap default; persisted in RegistrationPolicy thereafter
AUTH_GATE=true                           # true = enforce invite-only signup + email verify + MFA.
                                         #   false = local dev only (frictionless). MUST be true in any
                                         #   deployed/CI env. .env.example=true; local .env=false.
PUBLIC_APP_NAME=PFM                      # the one place a user-facing product name lives (rename later)
WEB_ORIGIN=                              # CORS allowlist
PORT=                                     # server listens on $PORT (Cloud Run requirement)
```

**Feature flags.** A single flag, `AUTH_GATE` (`apps/api/src/common/feature-flags.ts`), controls all
auth friction so the app can be tested against a local DB without invites/email/MFA. `true` →
invite-only signup (RegistrationPolicy + SignupInvite), email verification, and mandatory MFA all
enforced; `false` → signup needs no invite, email auto-verifies, and the MFA guard short-circuits. The
flag toggles *whether enforcement runs* — it never removes the rules — and **must be `true` in every
deployed and CI environment** (the committed `.env.example` defaults to `true`; only the local `.env`
sets `false`). It gates Epic 0.3 (auth/email verify), Epic 0.4 (MFA), and Epic 8 (invite-only signup).

In production these are supplied by **GCP Secret Manager**, injected into the Cloud Run service — not
committed anywhere. Locally they live in an uncommitted `.env`.

### 5.1 Hosting target — Google Cloud  *(the destination for step 3 of §5.2, not "deploy this now")*

- **API:** NestJS built into a container image, deployed to **Cloud Run** (scales to zero; HTTPS
  provided). The CI pipeline builds the image, pushes to Artifact Registry, and deploys the service.
- **Web:** Vite static build served from **Cloud Storage + Cloud CDN** (or any static host).
- **Database:** **Neon Postgres** (managed). Use the pooled connection string + Prisma's Neon serverless
  driver. Neon DB branches give preview/CI environments their own isolated data.
- **File storage:** uploaded statements encrypted in **Google Cloud Storage**, accessed behind the
  `@pfm/core` object-store interface (S3/GCS-compatible) so the provider is swappable.
- **Secrets:** **GCP Secret Manager**.
- **Async (Phase 2):** **Cloud Tasks / Pub-Sub** trigger a request-driven Cloud Run job for Plaid sync
  and heavy enrichment, behind a queue interface. Phase 1 needs none of this.

**Custom domain:** map `app.<domain>` to the Cloud Run service via Cloud Run **domain mapping** (verify
the domain once, add the `CNAME` Google provides; managed TLS is automatic). Graduate to a Global
External Load Balancer + serverless NEG later if you need apex-domain support, Cloud CDN, or Cloud Armor.

**Portability seam:** the deployable artifact is a plain container + a provider-neutral DB/storage/queue
interface — so moving off GCP (or running elsewhere) is a redeploy + config change, not a rewrite.
Don't reach for GCP-proprietary runtime APIs inside app code; keep that at the infra edge.

> **Cloud choice is reversible, so don't over-invest in it.** GCP Cloud Run + Neon is the target for its
> scale-to-zero economics and low ops overhead. Because the app is a container with a cloud-agnostic DB
> (Neon runs reachable from any cloud) and adapters at the edges, moving to AWS App Runner / Lambda or
> Azure Container Apps later is a redeploy, not a rewrite. AWS adds breadth + Bedrock-hosted Claude;
> Azure suits MS-ecosystem shops; neither is a Phase-1 factor.

### 5.2 Deployment sequence — local-first (do NOT host a persistent env yet)

Validate the product on your machine before paying for any infra. Serverless idles near-zero, but a
persistent hosted environment earns its keep only once there are humans to serve.

1. **Now — local only.** Run everything locally (`docker compose` Postgres or a Neon dev branch; local
   filesystem storage driver; `.env`). Validate with seed/mock data and your own real statements. CI
   runs lint + typecheck + test + **image build** on every PR — but **no deploy step yet**.
2. **Soon — one cheap smoke-deploy.** Deploy the walking skeleton (health + signup/login/MFA) to Cloud
   Run **once** to flush out container/IAM/secrets/DB-connection issues, then let it idle at zero (or
   tear it down). Cheaper substitute if even this feels early: run the production container locally via
   `docker run` regularly so you know the image is deployable.
3. **When you onboard the first invited testers — turn on continuous deploy.** Merge-to-`main` builds +
   deploys to a real environment. Lock it down (IAP/IP-allowlist + the Epic 8 invite gate). Stand up
   production only at limited-test launch.

**Local↔hosted parity rules (follow these while building so step 3 is config, not code):**

- **All config via env** — DB URL, secrets, storage, AI/KMS, `$PORT`, `PUBLIC_APP_NAME`. No hardcoded
  hosts, ports, or file paths; one config module reads env (`.env` locally, Secret Manager hosted).
- **Stateless; no local-disk persistence.** Uploads go through the `@pfm/core` object-store interface —
  `STORAGE_DRIVER=local` in dev, `gcs` in prod. Same code path.
- **Same Postgres engine both places** (Docker/Neon dev branch ↔ Neon prod) — only the connection
  string changes; Prisma is identical.
- **Container parity** — "runs in Docker locally" must equal "runs on Cloud Run." Keep the Dockerfile
  green from day one.
- **Provider calls at the edge only** — object store, queue, KMS behind interfaces; never sprinkled
  through business logic.
- **Ops basics present early** — `/health` endpoint, listen on `$PORT`, graceful shutdown, migrations
  as a runnable step.

---

## 6. Definition of Done (per story)

Code + tests written; acceptance criteria met; **visibility rules respected and leakage-tested** for
any account/transaction endpoint; money handled in integer minor units; sensitive actions audited; PR
links story ID + PRD ref; lint + typecheck + tests green; reviewed; squash-merged to the epic branch.

**Phase 1 is "done"** when a site-admin-invited user can: sign up (invitation-only) + verify + enroll
MFA; invite a partner who joins with their own login and role; add accounts via upload and/or manual
entry with per-account visibility; manage categories/sub-categories with safe deletion (optionally
AI-assisted via their own provider key); run monthly budgets with sub-categories and at least one
amortized sinking fund; and view an accurate shared dashboard with the household/personal toggle and
default charts — securely on the responsive web app. (AI is optional; the app is fully usable without a
key.)

---

## 7. Testing strategy

**Philosophy: risk-weighted, not uniform.** Most of Phase 1 is ordinary CRUD that needs only
happy-path coverage. A few areas can leak private data or miscompute money — those get exhaustive
treatment. Tests ship **in the same PR as the code** (Definition of Done). The bar is "trustworthy and
always green," not "100% coverage everywhere."

### 7.1 Risk tiers

Grade each story into a tier; spend test effort accordingly.

- **Tier A — exhaustive.** Visibility/leakage (E0.5), money math (amortization & sinking-fund reserves
  E6.3, budget roll-ups E6.1, dedup E2.4), MFA + auth enforcement (E0.3/E0.4). Unit + integration +
  property-based; hard coverage floor (~90%) — enforced **only on `@pfm/core`**.
- **Tier B — solid happy path + key edge cases.** Import pipeline (parse CSV/OFX/QFX, column mapping,
  unmatched account, overlapping re-import, multi-account file), category safe-deletion (E4.5),
  invite/join/role rules (E1.x). Integration tests with real fixtures; a handful of edge cases each.
- **Tier C — smoke only.** Plain CRUD endpoints and UI components. One happy-path test; do not gold-plate.

### 7.2 Test layers (the pyramid)

- **Unit (Vitest)** — the bulk. Pure logic in `@pfm/core`: `resolveScope`, dedup hash, amortization,
  money utils, period/date math. Fast, no DB.
- **Integration (Vitest + Nest testing + Supertest)** — endpoints against a **real Postgres** (see
  §7.4): the leakage suite, the import pipeline against fixture files, role/visibility mutations.
- **E2e (Playwright)** — a **thin cap of ~4 journeys** that mirror the PRD "done" checklist, no more:
  (1) signup → verify → MFA enroll → onboard; (2) invite → join with role; (3) upload statement →
  map columns → import → see it on the dashboard; (4) create a budget with an amortized sinking fund.
  Doubles as living documentation of the critical paths.

### 7.3 Two mandatory cross-cutting suites

Built as reusable harnesses so they're cheap to extend:

- **Leakage matrix.** A shared fixture: two members, accounts in each visibility state
  (shared / private / balance-only). A parametrized test that **every** account/transaction/dashboard
  endpoint runs through — member B never sees A's private line items; balance-only contributes to
  totals but hides line items; personal vs household mode respected. New endpoint → add one row.
- **Money invariants (property-based, `fast-check`, scoped to `@pfm/core`).** Amounts are always integer
  cents; `parent budget == sum(subcategories) + direct spend`; a reserve-funded payment is never
  double-counted; re-importing an overlapping statement never changes totals. ~A dozen properties,
  written once. Everywhere else stays example-based.

### 7.4 Test database (simple, shared, isolated by transaction)

No Testcontainers. Tests run against a **dedicated `pfm_test` database**, never the dev DB:

- Each developer owns their own local `pfm_test` (a second database in the Docker Compose Postgres),
  pointed to by `DATABASE_URL_TEST`.
- Migrations are applied to it before a run (`pnpm --filter @pfm/db migrate:test`).
- **Per-test isolation via transaction rollback:** each test opens a transaction and rolls it back at
  teardown, so the database returns to a clean baseline between tests despite being shared. Tests that
  must commit (rare) truncate their tables in an `afterEach`.
- **CI:** the integration job runs against a **GitHub Actions Postgres service container** (one sidecar
  per job) — same wire protocol, nothing to provision.

### 7.5 Determinism (anti-flake)

Injectable clock (freeze time for amortization/period boundaries), seeded RNG, **mocked SMTP** and a
**local object-store stub** (no real network in tests), and **test-data factories** in a small
`@pfm/testing` package so "a household with two members and three accounts in given visibility states"
is one call.

### 7.6 CI gating (GitHub Actions)

- **Every PR (blocking):** lint + typecheck + unit + integration. Integration job pins
  `runs-on: ubuntu-latest` with a Postgres service container. Merge blocked on red.
- **PRs into `main` + nightly:** the 4 Playwright e2e journeys (slower; not gated on every story PR).
- **Coverage:** floor enforced **only on `@pfm/core`** (~90%). No global coverage gate — rigor where it
  matters, no coverage theater on boilerplate.

### 7.7 Per-epic test focus (quick reference)

| Epic | Must test |
|---|---|
| E0 Foundation | Leakage matrix (all states), auth/refresh expiry, MFA enrollment-enforced & cannot-disable, money utils. |
| E1 Household | Last-owner cannot be removed/demoted; removed member's accounts detached not deleted; invite expiry. |
| E2 Accounts | Visibility defaults & owner-only changes; dedup hash skips duplicates, never double-counts. |
| E3 Import | Parse CSV/OFX/QFX fixtures; unmatched account forces a pick; overlapping re-import skips dupes; counts correct. |
| E4 Categories | Safe deletion can't orphan; parent total = subs + direct; protected Income undeletable. |
| E5 Transactions | Visibility-scoped list; recategorize + rule application; reserve-funded badge linkage. |
| E6 Budgets | Amortization spreads correctly; reserve accrues/draws without spike; shortfall flagged; sub-budgets roll up. |
| E7 Dashboard | Charts visibility-aware; household vs personal totals; reserve-funded segment on spending-over-time; **base-currency roll-ups exclude non-base accounts (no blending/conversion)**; period-comparison deltas correct for MoM/QoQ/YoY incl. period-boundary/year-ago resolution. |
| E8 Access | **Run auth/access + MFA suites with `AUTH_GATE=true`.** Signup blocked without a valid invite in `admin_invite` (server-side); invite consumed once; expired/revoked rejected; admin endpoints reject non-site-admins; first admin seeded. Add one test asserting `AUTH_GATE=false` bypasses invite/MFA (so the dev path is intentional, not accidental). |
| E9 BYOK AI | App works with no key (fallback); key never returned/logged; KMS round-trip; no data sent without consent; only normalized merchant leaves; confirmed suggestion writes a rule (no repeat LLM call). |
