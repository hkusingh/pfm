# Personal Finance Manager — Phase 1 Implementation Plan

**Audience:** Claude Code (VS Code) and the engineers driving it.
**Purpose:** Turn the Phase 1 PRD and epic breakdown into a concrete, buildable plan — stack,
repo layout, shared contracts, and an ordered set of stories→tasks with the files to create and the
acceptance bar for each.
**Source of truth:** `docs/phase1-spec.md` (PRD), `docs/phase1-technical-design.html` (tech design),
`docs/phase1-epics-and-stories.md` (epics). This plan operationalizes them; it does not override them.

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

**Scope reminders:** Phase 1 = limited-user test. Data path is **document upload + manual entry only**.
**Plaid is Phase 2** (data model leaves seams; we don't build it). AI features have no user-facing
surface in Phase 1.

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
    core/       # visibility scope, dedup hash, amortization, money utils, dates/periods
    ui/         # design tokens + base components + chart wrappers
    config/     # eslint / tsconfig / tailwind / vitest presets
    testing/    # test-data factories + leakage-matrix harness + clock/RNG/SMTP/object-store stubs
  docs/         # existing planning docs (source of truth)
  docker-compose.yml   # postgres for local dev (redis only when the Phase 2 worker lands)
  Dockerfile(s)        # per deployable app — the unit of deploy to Cloud Run
  turbo.json, pnpm-workspace.yaml, package.json
```

Package names: `@pfm/api`, `@pfm/web`, `@pfm/contracts`, `@pfm/db`, `@pfm/core`,
`@pfm/ui`, `@pfm/config`, `@pfm/testing` (Phase 1) · `@pfm/worker` (Phase 2).

Each deployable app ships a **Dockerfile** (Next-free; `api` builds a Node server image, `web` a static
bundle). The container is the unit of deploy — this is the portability seam that keeps us off any single
host's lock-in.

---

## 2. Shared contracts (define in Epic 0, treat as stable)

### 2.1 Data model (Prisma — entities & key fields)

Build these in `packages/db`. Names are guidance; keep the relationships and the marked constraints.

- **User** — `id`, `email` (unique), `passwordHash`, `emailVerifiedAt`, timestamps.
- **MfaMethod** — `id`, `userId`, `type` (`totp` | `email`), `secret` (encrypted), `isPrimary`,
  `confirmedAt`. Plus `RecoveryCode` (`userId`, `codeHash`, `usedAt`).
- **Household** — `id`, `name`, `baseCurrency`, `monthStartDay` (default 1).
- **Membership** — join entity: `id`, `householdId`, `userId`, `role` (`owner` | `member`),
  `status`, `joinedAt`. *(Membership is many-to-many on purpose so multi-household is a later
  constraint relaxation, not a re-architecture. Phase 1 enforces one active household per user.)*
- **Invite** — `id`, `householdId`, `email`, `role`, `token` (unique), `expiresAt`, `status`
  (`pending`|`accepted`|`revoked`), `invitedByUserId`.
- **Account** — `id`, `householdId`, `ownerUserId`, `name`, `type`, `source`
  (`manual` | `import`; `plaid` reserved for Phase 2), `institution`, `mask`, `balanceMinor`,
  `currency`, `visibility` (`shared` | `private` | `balance_only`). **Scoped to household + owner.**
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
| **1** | Epic 0 — Foundation | Must merge to `main` before Wave 2 starts. |
| **2** | Epic 1 (Household), Epic 2 (Accounts), Epic 4 (Categories) | Build on the kernel, in parallel. |
| **3** | Epic 3 (Import — **high priority**), Epic 5 (Transactions), Epic 6 (Budgets) | Stub upstream where needed. |
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
- Email/password signup, `argon2` hashing, email verification, login, JWT access + refresh with
  rotation and inactivity expiry. Contracts in `@pfm/contracts/auth`.
- **Done when:** a verified user can log in and refresh; expired/invalid tokens rejected; tests cover it.

**E0.4 Mandatory MFA** *(L)* — PRD: S-2
- TOTP (`otplib`) + email-code methods; primary + backup; recovery codes shown once; enrollment
  enforced in onboarding before app access; rate-limit/lockout on failures; recovery via backup/codes.
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

- **E1.1 Create household on signup** *(S, H-1)* — first user = Owner; household has name, base
  currency, month-start.
- **E1.2 Invite member with role** *(M, H-2/H-4)* — invite by email + role; unique expiring link;
  pending invites listed; resend/revoke.
- **E1.3 Accept invite & join** *(M, H-3)* — invitee creates own login (+MFA), joins, sees shared view
  per permissions; existing email → link to household after confirmation (one active household/user).
- **E1.4 Manage roles & remove member** *(M, H-4/H-5)* — change role; remove (access revoked
  immediately; their accounts **detached not deleted**); cannot remove/demote the last owner.
- **E1.5 Household settings** *(S, H-1)* — edit name/currency/month-start; member list with roles +
  last login. *(Member/role/visibility changes write AuditLog.)*

### Epic 2 — Accounts & Manual Entry  *(Wave 2)*  — depends on E0

- **E2.1 Account model** *(M, A-1/A-2)* — account scoped to household+owner; sources `manual`/`import`
  (Plaid reserved Phase 2); balance/institution/mask.
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
  show **actuals**.
- **E7.3 Reserve-funded marking on spending-over-time** *(S, B-6)* — in the Actual view, the
  reserve-funded portion of a month is a distinct labeled segment so the spike is self-explaining.
- **Phase 2 (do not build):** custom chart builder, net worth charts, rental cash-flow report.

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
```

Every account/transaction/dashboard endpoint resolves a `Scope` and passes it to the data layer.

---

## 5. Environment & configuration

`.env.example` (commit it; never commit real `.env`):

```
DATABASE_URL=postgresql://...            # Neon (use the pooled connection string)
DATABASE_URL_TEST=postgresql://...       # dedicated pfm_test database for integration tests
JWT_ACCESS_SECRET=        JWT_REFRESH_SECRET=        ENCRYPTION_KEY=   # for at-rest field/file encryption
SMTP_URL=                                # email verification + MFA email codes
GCS_BUCKET=  GOOGLE_APPLICATION_CREDENTIALS=         # encrypted statement-file storage (GCS)
WEB_ORIGIN=                              # CORS allowlist
```

In production these are supplied by **GCP Secret Manager**, injected into the Cloud Run service — not
committed anywhere. Locally they live in an uncommitted `.env`.

### 5.1 Hosting (Stage 1 / limited test) — Google Cloud

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

---

## 6. Definition of Done (per story)

Code + tests written; acceptance criteria met; **visibility rules respected and leakage-tested** for
any account/transaction endpoint; money handled in integer minor units; sensitive actions audited; PR
links story ID + PRD ref; lint + typecheck + tests green; reviewed; squash-merged to the epic branch.

**Phase 1 is "done"** when a two-person household can: sign up + verify + enroll MFA; invite a partner
who joins with their own login and role; add accounts via upload and/or manual entry with per-account
visibility; manage categories/sub-categories with safe deletion; run monthly budgets with sub-categories
and at least one amortized sinking fund; and view an accurate shared dashboard with the
household/personal toggle and default charts — securely on the responsive web app.

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
| E7 Dashboard | Charts visibility-aware; household vs personal totals; reserve-funded segment on spending-over-time. |
