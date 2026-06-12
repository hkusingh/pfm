# CLAUDE.md — PFM Working Guide for Coding Agents

This file tells Claude Code how to work in this repository. Read it first, every session.
The product/requirements source of truth lives in [`/docs`](./docs); the build plan is
[`IMPLEMENTATION_PLAN.md`](./IMPLEMENTATION_PLAN.md). When code and docs disagree, the docs win —
raise the conflict rather than silently diverging.

> **Current status (2026-06-12):** Waves 1–4 are **done** (Epics 0–8, E5, E7 merged to `main`).
> Active work: **Epic 10 — Dashboard & Transaction UX Polish** on branch
> `epic/10-dashboard-transactions-ux`. See the **"Status & Next Up"** section at the top of
> `IMPLEMENTATION_PLAN.md` for the full ordered work list.
> **Deployment is local-first — do not stand up a hosted environment yet** (IMPLEMENTATION_PLAN §5.2).

---

## 1. What we are building

A **household-first** Personal Finance Manager. Phase 1 is a **limited-user test**: families sign up
with mandatory MFA, add accounts by **uploading statements (CSV/OFX/QFX) or manual entry** (no live
bank aggregation yet), set per-account visibility, manage categories, run monthly budgets with
amortized "sinking funds", and view a shared spending dashboard.

**The backend is a standalone API.** Phase 1 ships a web client, but a native mobile app and a chat
agent are planned consumers of the *same* API. Treat the API and its contracts as a public product,
not an implementation detail of the web app.

## 2. Non-negotiable guardrails

These are correctness and safety rules. A change that violates one is wrong even if tests pass.

1. **Visibility is mandatory.** Every read of account/transaction/balance data goes through the
   central visibility scope helper in `packages/core`. No query bypasses it. Every endpoint that
   returns account/transaction data ships with a cross-member **leakage test**.
2. **No Plaid / no bank credentials in Phase 1.** Live aggregation is Phase 2. Never store bank login
   credentials anywhere, in any phase. The data model leaves seams for Plaid but we do not build it now.
3. **MFA cannot be disabled (in any real environment).** Enrollment is enforced during onboarding
   before app access; methods (TOTP, email code) can change, the requirement cannot be turned off.
   *The single `AUTH_GATE` flag (see guardrail 9) may relax this **for local development only** — it
   must be `true` in every deployed/CI environment. Never remove the enforcement code.*
4. **Encryption + least privilege.** Financial data encrypted in transit and at rest; uploaded
   statement files stored encrypted; access scoped to the authenticated user's permissions.
5. **Audit sensitive actions.** Member/role changes, visibility changes, and data exports write an
   audit record.
6. **Money math is integer-safe.** Store and compute monetary amounts in **minor units (integer
   cents)** with an explicit currency. Never use floats for money.
7. **Signup is invitation-only (in any real environment).** Phase 1 runs `RegistrationPolicy =
   admin_invite`: no account is created without a valid `SignupInvite`, enforced **server-side** at the
   signup endpoint (not just hidden in UI). Site-admin endpoints require `isSiteAdmin` + MFA. (Epic 8.)
   *Relaxed by `AUTH_GATE=false` for local dev only — see guardrail 9.*
8. **AI is optional and BYOK.** AI uses the household's **own** provider key; the app must work fully
   with no key (fall back to rules/uncategorized). Never store a key in plaintext (KMS envelope
   encryption), never return or log it, never send transaction data to a provider without recorded
   consent, and send only the normalized merchant (+ amount) — never account numbers or identities.
   (Epic 9.)
9. **`AUTH_GATE` is a dev-only convenience, not a real toggle.** A single flag
   (`apps/api/src/common/feature-flags.ts`) gates the auth friction: `AUTH_GATE=true` enforces
   invite-only signup, email verification, and mandatory MFA; `AUTH_GATE=false` disables all three so
   developers can sign up and reach the app instantly against a local DB. **It must be `true` in every
   deployed and CI environment** — the checked-in `.env.example` defaults to `true`; only the local
   `.env` sets `false`. The flag selects *whether* the rules run; it never deletes them. Do not add new
   `AUTH_GATE` branches that change behavior beyond enable/disable of these three checks.

If a task seems to require breaking one of these, stop and flag it.

## 3. Architecture & repo layout

TypeScript everywhere, pnpm workspaces + Turborepo monorepo. Standalone API; web/mobile/agent are
clients of it.

```
pfm/
  apps/
    api/         # NestJS HTTP API (stateless). One module per epic/domain. Container → Cloud Run.
    web/         # Vite + React SPA (pure API client). Static build → Cloud Storage + Cloud CDN.
    # worker/    # (Phase 2) async jobs (Plaid sync, heavy enrichment) — Cloud Run job via Cloud Tasks
    # mobile/    # (Phase 2+) Expo / React Native — consumes packages/contracts
    # agent/     # (Phase 3) chat agent — calls packages/core + the API
  packages/
    contracts/   # Zod schemas + inferred TS types for every API request/response. THE contract.
    db/          # Prisma schema, client, migrations, seed
    core/        # Framework-agnostic domain logic: visibility scope helper, dedup hashing,
                 # amortization/sinking-fund math, money utils, object-store + queue interfaces.
    ui/          # Web design system: tokens, base components, chart wrappers (Recharts)
    config/      # Shared eslint / tsconfig / tailwind / vitest presets
    testing/     # Test factories, leakage-matrix harness, clock/RNG/SMTP/object-store stubs
  docs/          # Product + technical planning (source of truth) — do not edit as part of coding tasks
```

**Dependency direction:** `contracts` and `core` depend on nothing app-specific. `api` and `web` depend
inward on packages, never on each other. Clients (`web`, future `mobile`, `agent`) only touch the server
through `contracts` + HTTP.

## 4. Pinned stack

- **Language:** TypeScript (strict).
- **API:** NestJS. Each epic = a Nest module. Auth via a global guard; visibility enforced in a
  guard/interceptor + repository layer.
- **DB / ORM:** **Neon Postgres** (pooled connection string + Prisma's Neon serverless driver);
  migrations checked in.
- **Hosting:** **Google Cloud Run** (the `api` container) + Cloud Storage/CDN (the `web` static build);
  GCS for encrypted uploads; GCP Secret Manager for secrets. Every deployable app ships a `Dockerfile`;
  the container is the unit of deploy. Keep GCP-specific calls at the infra edge, behind the
  object-store/queue interfaces in `@pfm/core`, so the app stays portable.
- **Validation / contracts:** Zod schemas in `packages/contracts`, shared by server and all clients.
- **Auth:** JWT access + refresh (`jose`), passwords hashed with `argon2`, TOTP via `otplib`, email
  codes via `nodemailer`.
- **Jobs:** none in Phase 1 (import parsing runs inline). Phase 2 adds Cloud Tasks/Pub-Sub → a Cloud Run
  job behind the `@pfm/core` queue interface. No Redis/BullMQ in Phase 1.
- **Web:** Vite + React + React Router + TanStack Query; Tailwind; Recharts for charts.
- **Testing:** Vitest (unit + integration), Nest testing + Supertest, Playwright (e2e), `fast-check`
  (property tests on `@pfm/core` only). Integration runs against a dedicated `pfm_test` Postgres with
  per-test transaction rollback — see IMPLEMENTATION_PLAN §7 for the full strategy.

> Stack is pinned for determinism. If you believe a swap is warranted, propose it in the PR rather
> than substituting silently.

## 5. Commands

Run from the repo root unless noted. (Scripts are defined as the foundation epic lands; if a command
is missing, that is an E0 gap — flag it.)

```bash
pnpm install                 # install workspace deps
pnpm dev                     # run api + web in watch mode (turbo)
pnpm --filter @pfm/api dev   # run a single app
pnpm build                   # build all packages/apps
pnpm lint                    # eslint across the workspace
pnpm typecheck               # tsc --noEmit across the workspace
pnpm test                    # unit + integration tests
pnpm test:e2e                # Playwright end-to-end (the 4 critical journeys)
pnpm --filter @pfm/db migrate:dev    # create/apply a dev migration
pnpm --filter @pfm/db migrate:test   # apply migrations to the pfm_test DB
pnpm --filter @pfm/db seed           # seed default categories etc.
```

First-time setup is automated: **`./scripts/setup-dev.sh`** (checks prereqs, writes `.env` with
generated secrets + `AUTH_GATE=false`, starts Postgres, installs, migrates dev+test DBs, seeds), then
`pnpm dev`. Full guide + troubleshooting: [`docs/development-setup.md`](./docs/development-setup.md).

## 6. How to work

- **Contracts first.** Before implementing an endpoint, define/verify its Zod schema and types in
  `packages/contracts`. Server validates input/output against it; clients import the inferred types.
- **Vertical slices.** A story includes DB + API + UI where applicable. Hide incomplete work behind a
  feature flag rather than leaving a broken path.
- **Stub upstream deps.** If your epic depends on another that isn't merged, mock against the contract
  so you're not blocked; integrate at the wave boundary.
- **Small PRs.** One story per PR; link the story ID (e.g. `E4.5`) and the PRD requirement (e.g. `C-5`).
- **Tests with the code.** Every story adds tests for its acceptance criteria. Endpoints over
  account/transaction data add a visibility leakage test. Don't mark a task done with failing tests or
  a partial implementation.
- **No brand name in code.** The product name is undecided. Use the working name `pfm`/`@pfm/*` only.
  The user-facing app title comes from a single `APP_NAME` constant in `packages/config` (sourced from
  the `PUBLIC_APP_NAME` env var); never hardcode a product/brand name in UI copy, page titles, emails,
  or package names.
- **Wireframes are the UI specification.** Before implementing any screen, panel, or component, open
  `docs/wireframes-phase1.html` and match the layout, element positions, labels, and interactions
  exactly. If the wireframe conflicts with a PRD requirement, raise the conflict — do not resolve it
  silently. Deviations require explicit sign-off.

## 7. Branching (see CONTRIBUTING.md)

- `main` — protected, always green, releasable.
- `epic/<n>-<name>` — long-lived, one per epic (e.g. `epic/2-accounts`).
- `story/<id>-<slug>` — short-lived; PR into the epic branch (e.g. `story/E2.3-visibility`).

Squash-merge story → epic; merge epic → `main` at wave boundaries. CI (lint + typecheck + tests) must
pass and at least one review is required.

## 8. Build order (summary)

Epic 0 — Foundation is **complete**. Current waves:

- **Wave 2 (now):** Epic 1 (Household), Epic 2 (Accounts), Epic 4 (Categories), **Epic 8 (Platform
  Access & Site Admin — invitation-only signup; start early, it gates Epic 1's signup).**
- **Wave 3:** Epic 3 (Import — high priority), Epic 5 (Transactions), Epic 6 (Budgets), **Epic 9 (BYOK
  AI categorization).**
- **Wave 4:** Epic 7 (Dashboard).

Full breakdown + the ordered next-up list in [`IMPLEMENTATION_PLAN.md`](./IMPLEMENTATION_PLAN.md)
("Status & Next Up" section) and [`docs/phase1-epics-and-stories.md`](./docs/phase1-epics-and-stories.md).

## 9. Source-of-truth docs

- `docs/phase1-spec.md` — Phase 1 PRD (requirement IDs, acceptance criteria, edge cases).
- `docs/phase1-technical-design.html` — architecture, data model, visibility, import pipeline, API.
- `docs/phase1-epics-and-stories.md` — epics → stories with PRD refs.
- `docs/feature-breakdown.docx`, `docs/discovery-brief.docx` — product rationale and phasing.
- `docs/ai-features-and-architecture.html`, `docs/roadmap.html` — Phase 2/3 direction (don't build now,
  but don't foreclose).
