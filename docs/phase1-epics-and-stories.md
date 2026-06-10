# Personal Finance Manager — Phase 1 Epics & Stories

**Prepared for:** Harsh
**Date:** June 4, 2026
**Version:** 0.1
**Purpose:** Sprint-ready breakdown of Phase 1, structured for **parallel development by multiple people** and clean merging. Stories trace to the Phase 1 PRD (`phase1-spec.md`) and Technical Design (`phase1-technical-design.html`).

---

## 1. How This Is Organized for Parallel Work

Phase 1 is split into one **foundation epic** (the shared kernel everyone builds on) and several **feature epics** that can be developed in parallel once the kernel lands.

**The rule:** the foundation epic (Epic 0) must merge first. It establishes the data model, auth, the visibility/permission helper, the API conventions, and the design system — the shared contracts. After that, feature teams work on separate epics in their own branches against those contracts, stubbing dependencies where needed.

### 1.1 Dependency graph

```mermaid
flowchart TD
  E0[Epic 0 — Foundation / Shared Kernel]:::k
  E1[Epic 1 — Household & Membership]:::a
  E2[Epic 2 — Accounts & Manual Entry]:::a
  E4[Epic 4 — Categories]:::a
  E3[Epic 3 — Document Upload & Import]:::b
  E5[Epic 5 — Transactions]:::b
  E6[Epic 6 — Budgets & Sinking Funds]:::b
  E7[Epic 7 — Dashboard & Reports]:::c

  E0 --> E1
  E0 --> E2
  E0 --> E4
  E2 --> E3
  E2 --> E5
  E4 --> E5
  E4 --> E6
  E5 --> E7
  E6 --> E7
  classDef k fill:#1F4E79,color:#fff,stroke:#1F4E79;
  classDef a fill:#eaf1f8,stroke:#2E6DA4,color:#1c2530;
  classDef b fill:#fbf1df,stroke:#B9770E,color:#1c2530;
  classDef c fill:#e6f5ec,stroke:#1F8A4C,color:#14532d;
```

### 1.2 Suggested parallel waves

| Wave | Epics (parallel) | Notes |
|---|---|---|
| **Wave 1** | Epic 0 ✅ *(done)* | Foundation — everyone depends on it; land first. |
| **Wave 2** | Epic 1, Epic 2, Epic 4, **Epic 8** | Independent feature areas on the kernel. **Epic 8 (invitation-only access) gates signup — start early.** |
| **Wave 3** | Epic 3, Epic 5, Epic 6, **Epic 9** | Build on accounts/categories; stub where needed. **Epic 3 (document upload) is the Phase 1 data path** — treat as high priority. |
| **Wave 4** | Epic 7 | Integrates transactions + budgets; lands last. |

> **Phase 1 scope note:** Phase 1 is a **limited-user test release** and is **invitation-only** (Epic 8). Data enters via **document/statement upload (Epic 3) and manual entry (Epic 2) only**. **Plaid live aggregation is deferred to Phase 2** — its stories are listed under Epic 2 as Phase 2 for forward planning, not Phase 1 work. A thin **BYOK AI categorization** slice (Epic 9) is included in Phase 1: households may supply their own LLM provider key; AI is always optional. The broader AI insights platform remains Phase 2.

### 1.3 Working agreements (parallel + merge)

- **One epic = one team = one long-lived feature branch**, with short-lived story branches merged into it via PR.
- **Contracts first.** API request/response shapes and the visibility-scope helper are defined in Epic 0 and treated as stable interfaces. Changes to a shared contract require a cross-team PR review.
- **Stub dependencies.** Teams mock upstream modules (e.g. Transactions stubs Accounts) so no one is blocked; integrate against real modules at the wave boundary.
- **Vertical slices.** Each story includes backend + API + UI where applicable, behind a feature flag if partially complete.
- **Definition of Done:** code + tests, meets acceptance criteria, visibility rules respected, PR reviewed, merged to the epic branch with green CI.

### 1.4 Story conventions

- IDs: `E<epic>.<story>` (e.g. `E2.3`). **PRD ref** links to the spec requirement. **Size:** S / M / L (rough).
- Acceptance criteria (AC) are testable and double as the basis for automated tests.

---

## 2. Epic 0 — Foundation / Shared Kernel

**Goal:** the shared substrate all feature epics build on. **Must merge before Wave 2.** Owned by a lead/platform pair.

- **E0.1 — Project scaffolding & CI/CD.** *(Size: M)*
  - AC: Repo bootstrapped (client + API + DB migrations); local dev runs with one command.
  - AC: CI runs lint + tests on PR; main protected; preview/staging deploy configured.
- **E0.2 — Data model & migrations.** *(PRD: Tech Design §2 · Size: L)*
  - AC: Tables for user, household, membership, account, transaction, category, budget, sinking_fund, category_rule, mfa_method per the ER model.
  - AC: `user` has `name` (required) + optional `date_of_birth` / `locale` / `timezone`; `membership` has `role` + `is_primary_owner`; `account` has its own `currency`; `household` has `base_currency` ∈ {USD, EUR, GBP, INR}.
  - AC: Account scoped to `household_id` + `owner_user_id`; category self-referential; `dedup_hash` on transaction; nullable `tag` field reserved for Phase 2.
- **E0.3 — Authentication.** *(PRD: S-1, S-3 · Size: M)*
  - AC: Email/password/**name** signup, password hashing, email verification, login, session/token issuance + expiry/refresh. (DoB is an optional profile field, not collected at signup.)
- **E0.4 — Mandatory MFA.** *(PRD: S-2 · Size: L)*
  - AC: TOTP (Google Authenticator) and email-code methods; primary + backup; recovery codes generated once.
  - AC: MFA enrollment enforced during onboarding before app access; cannot be disabled (method changeable).
  - AC: Rate-limiting/lockout on failed attempts; recovery via backup/codes.
- **E0.5 — Authorization & visibility helper.** *(PRD: A-4, NFR-2 · Size: L)*
  - AC: A central helper resolves, per request, the viewer's accessible account IDs and field-level rules (shared / private / balance-only).
  - AC: All repository/query methods require the visibility scope as a mandatory parameter; totals computed from the same scope.
  - AC: Unit tests prove no cross-member leakage for each visibility state.
- **E0.6 — Design system / component library.** *(PRD: NFR-1, NFR-6 · Size: M)*
  - AC: Shared tokens (color/typography), base components (nav shell, cards, tables, forms, buttons, charts wrapper), responsive layout, accessibility baseline.
- **E0.7 — API conventions & gateway.** *(Size: S)*
  - AC: Standard error/validation envelope, pagination, auth middleware, rate limiting; documented for all teams.

---

## 3. Epic 1 — Household & Membership

**Goal:** households can be created and shared with configurable roles. **Depends on:** E0. **Parallel with:** Epics 2, 4.

- **E1.1 — Create household on signup.** *(PRD: H-1 · Size: S)*
  - AC: First user becomes the primary Owner (`role:owner` + `is_primary_owner`); household has name, base currency (USD/EUR/GBP/INR), month-start.
- **E1.2 — Invite member with role.** *(PRD: H-2, H-4 · Size: M)*
  - AC: Invite by email with role (co-owner / member); unique expiring link; pending invites listed; resend/revoke.
- **E1.3 — Accept invite & join.** *(PRD: H-3 · Size: M)*
  - AC: Invitee creates own login (+ MFA via E0.4), joins household, sees shared view per permissions.
  - AC: Email already registered → link to this household after confirmation (one active household per user in Phase 1).
- **E1.4 — Manage roles & remove member.** *(PRD: H-4, H-5 · Size: M)*
  - AC: Owner/co-owner changes a member's role (owner↔member; "co-owner" = `role:owner`, non-primary); removes a member (access revoked immediately; their accounts detached not deleted).
  - AC: Cannot remove/demote the primary owner while they are the sole owner.
- **E1.5 — Household settings.** *(PRD: H-1 · Size: S)*
  - AC: Edit household name, currency, month-start; member list shows roles and last login.

---

## 4. Epic 2 — Accounts & Manual Entry

**Goal:** account model, manual accounts, and per-account visibility. **Depends on:** E0. **Parallel with:** Epics 1, 4.
**Phase 1 scope.** Plaid live aggregation is **Phase 2** (stories listed at the end for forward planning).

- **E2.1 — Account model.** *(PRD: A-1, A-2 · Size: M)*
  - AC: Account entity scoped to household + owner; supports sources `manual` and `import` (Plaid source added in Phase 2); balance, institution, mask fields; **per-account `currency`** (USD/EUR/GBP/INR, defaults to household base; no FX conversion).
- **E2.2 — Manual account & transactions.** *(PRD: A-2 · Size: M)*
  - AC: Add a manual cash/unsupported account; add/edit transactions by hand.
- **E2.3 — Per-account visibility.** *(PRD: A-3 · Size: M)*
  - AC: Owner sets shared / private / balance-only; only the owner can change; enforced via E0.5; defaults (joint→shared, individual→private).
- **E2.4 — De-duplication.** *(PRD: A-4 · Size: M)*
  - AC: `dedup_hash` (account + date + amount + normalized merchant) skips duplicates across repeat imports; never double-counts.

**Phase 2 (forward planning — not Phase 1 work):**

- **E2.P2a — Plaid Link connect & token exchange.** *(PRD: A-7)* — link_token/public_token exchange; store encrypted access_token; no bank credentials stored.
- **E2.P2b — Initial + delta sync & webhooks.** *(PRD: A-7)* — fetch/enrich/categorize; handle `SYNC_UPDATES_AVAILABLE`, `ITEM_LOGIN_REQUIRED`.
- **E2.P2c — Connection health & re-auth UI.** *(PRD: A-7)*
- **E2.P2d — Joint account de-dup across members.** *(PRD: A-4)* — same joint account linked by two members merged.

---

## 5. Epic 3 — Document Upload & Import  ·  *Phase 1 primary data path*

**Goal:** get transactions in via uploaded statement files with no stored credentials — the main way data enters in Phase 1. **Depends on:** E2 (account model). **Parallel with:** Epics 5, 6. **Priority: high.**

- **E3.1 — Upload & parse.** *(PRD: A-1 · Size: M)*
  - AC: Accept CSV/OFX/QFX to encrypted store; parse rows; report row count. (PDF parsing out of scope.)
- **E3.2 — Account detection & selection.** *(PRD: A-1 · Size: M)*
  - AC: Detect account from header (mask/institution); pre-select target; allow new manual account; **must pick if unmatched** (no silent assignment).
- **E3.3 — Column mapping.** *(PRD: A-1 · Size: M)*
  - AC: Map file columns → Date / Merchant / Amount; remember mapping per source for repeat imports.
- **E3.4 — Enrich, dedup & commit.** *(PRD: A-1 · Size: M)*
  - AC: Enrich/auto-categorize imported rows; skip duplicates via `dedup_hash`; commit and report imported/skipped counts.

---

## 6. Epic 4 — Categories & Sub-categories

**Goal:** household category structure with safe management. **Depends on:** E0. **Parallel with:** Epics 1, 2.

- **E4.1 — Default categories seed.** *(PRD: C-1 · Size: S)*
  - AC: Sensible defaults seeded per household; protected Income category present.
- **E4.2 — Manage categories.** *(PRD: C-2 · Size: M)*
  - AC: Add, rename, recolor, reorder, delete; reachable from Budgets → Manage categories; system categories protected.
- **E4.3 — Sub-categories.** *(PRD: C-3 · Size: M)*
  - AC: Nest under a parent; roll up to parent (parent total = subs + direct spend); collapsed by default in UI.
- **E4.4 — Income sub-categories.** *(PRD: C-4 · Size: M)*
  - AC: Income supports sub-categories; tracked received vs. expected (not a spend cap); visibility-aware (balance-only rolls up to total without line items).
- **E4.5 — Safe deletion.** *(PRD: C-5 · Size: M)*
  - AC: Deleting a category with transactions prompts reassign/merge; deletion cannot orphan transactions; parent with children prompts handling of children.
- **E4.6 — Recategorize & rules.** *(PRD: C-6 · Size: M)*
  - AC: Change a transaction's category; optionally create a merchant rule that auto-applies going forward.

---

## 7. Epic 5 — Transactions

**Goal:** view, search, and correct transactions. **Depends on:** E2, E4. **Parallel with:** Epics 3, 6.

- **E5.1 — Transaction list.** *(PRD: D-4 · Size: M)*
  - AC: Visibility-scoped list across accessible accounts; search + filter (date, account, category); pagination.
- **E5.2 — Recategorize from list.** *(PRD: C-6, D-4 · Size: S)*
  - AC: Inline recategorize; optional rule creation (shares logic with E4.6).
- **E5.3 — Reserve-funded payment marking.** *(PRD: B-6 · Size: M · depends on E6.3)*
  - AC: A transaction matching a sinking-fund item is linked and badged ("annual · from reserve"); auto-detected with user confirm/override.

---

## 8. Epic 6 — Budgets & Sinking Funds

**Goal:** monthly budgets plus amortized annual expenses. **Depends on:** E4. **Parallel with:** Epics 3, 5.

- **E6.1 — Monthly budgets.** *(PRD: B-1 · Size: M)*
  - AC: Set budget per category/sub-category; track spent vs. remaining for current period; sub-budgets roll up to parent.
- **E6.2 — Budget visualization.** *(PRD: B-2 · Size: M)*
  - AC: Bars show magnitude (length ∝ budget) and utilization (fill = spent); near-limit/over states; sub-categories collapsed by default, expand on demand.
- **E6.3 — Sinking funds (amortized).** *(PRD: B-3, B-5 · Size: L)*
  - AC: Mark recurring non-monthly expense (annual/semi/quarterly) as amortized; virtual reserve accrues monthly; actual payment draws from reserve (no budget spike).
  - AC: Reserve progress shown (saved vs. target, next due, behind/ahead); monthly view amortized, yearly view true total; **virtual reserves only**.
  - AC: Method selectable (amortized default vs. actual); mid-year start defaults to gradual catch-up; shortfall flagged if reserve insufficient.
- **E6.4 — Income tracking.** *(PRD: B-4 · Size: S)*
  - AC: Income shows received vs. expected per income (sub-)category; not a spend limit.

> **Note:** the Actual/Smoothed spending toggle (PRD B-7) is **Phase 2** — out of scope here.

---

## 9. Epic 7 — Dashboard & Reports (Phase 1 subset)

**Goal:** the at-a-glance shared view. **Depends on:** E5, E6. **Integrates last (Wave 4).**

- **E7.1 — Dashboard KPIs & view toggle.** *(PRD: D-1, D-2 · Size: M)*
  - AC: KPIs (income, spending, budget remaining); budget vs. actual; household/personal toggle (personal = own accounts only; household respects visibility).
- **E7.2 — Default charts.** *(PRD: D-3 · Size: M)*
  - AC: Spending by category, spending over time (**6-month default**, 3M/6M toggle), income vs. expenses, budget vs. actual; interactive (hover amounts); visibility-aware; show actuals; **currency-aware** (base-currency roll-ups only; non-base accounts in a separate per-currency breakdown, never blended/converted).
- **E7.3 — Reserve-funded marking on spending-over-time.** *(PRD: B-6 · Size: S)*
  - AC: In the Actual view, the reserve-funded portion of a month is a distinct, labeled segment so the spike is self-explaining.
- **E7.4 — Period comparison report.** *(PRD: D-5 · Size: M)*
  - AC: Compare spending by category across two periods with selectable granularity (month/quarter/year over the prior or year-ago period); show per-category totals + absolute/% change + total row; categories expand to sub-categories; visibility- and currency-aware; savable to dashboard.

> Custom chart builder, net worth charts, and rental cash-flow report are **Phase 2**. The period-comparison report (E7.4) is a fixed report, not the custom builder.

---

## 9a. Epic 8 — Platform Access & Site Admin  *(added 2026-06-10)*

**Goal:** Phase 1 is **invitation-only** — only people the site admin invites can create an account. Built as a policy toggle that later opens to a household-invites-household **beta**, then **general availability**. **This is platform-level access, distinct from the household *member* invites in Epic 1.** **Depends on:** E0. **Parallel with:** Epics 1, 2, 4 (Wave 2). **Start early — it gates signup.**

- **E8.1 — Registration policy & gated signup.** *(PRD: S-6 · Size: M)*
  - AC: Global `RegistrationPolicy.mode` (`admin_invite` | `beta_invite` | `open`); Phase 1 default `admin_invite`.
  - AC: In `admin_invite`, the signup endpoint requires a valid, unexpired `SignupInvite` for that email, consumed on success; enforced **server-side**; rate-limited. No invite → no account.
- **E8.2 — Site-admin role & bootstrap.** *(Size: S)*
  - AC: `User.isSiteAdmin`; admin-only guard; **first site admin seeded** (`hksingh@gmail.com`) via migration/seed (no admin exists to invite the first one).
- **E8.3 — Admin area (guarded `/admin`, not a separate app).** *(Size: M)*
  - AC: Site-admin-only routes + API to issue / list / resend / revoke `SignupInvite`s, view pending vs. accepted, basic user list. Requires site-admin **and** MFA; intended behind IAP/IP-allowlist when hosted.
- **E8.4 — Beta & GA policy switches (forward-built).** *(Size: S)*
  - AC: `beta_invite` lets an existing household issue signup-invites with a per-household quota (`issuedByHouseholdId`), reusing the `SignupInvite` flow; `open` requires no invite. Phase 1 ships the toggle + `admin_invite` path; beta/GA are config flips.

## 9b. Epic 9 — BYOK AI Categorization  *(added 2026-06-10)*

**Goal:** let a household supply **their own** AI provider key (Claude / OpenAI / Gemini) and use that LLM to interpret/categorize expenses. **Always optional and feature-flagged** — the app works fully with no key (falls back to rules/uncategorized). **Depends on:** E2, E4. **Parallel with:** Epics 3, 5, 6 (Wave 3). The broader AI insights platform stays **Phase 2**.

- **E9.1 — Provider-agnostic LLM layer.** *(PRD: AI-1 · Size: M)*
  - AC: `@pfm/ai` exposes an `LlmProvider` interface (`categorizeTransaction`, `interpretExpense`) with Anthropic / OpenAI / Google adapters; no provider SDK leaks past the interface.
- **E9.2 — BYOK credential management.** *(PRD: AI-2 · Size: M)*
  - AC: Key stored with **KMS envelope encryption** (ciphertext only), validated on save, **write-only** (surface provider + last-4 + status), rotate/revoke; **per-household**, set by an owner, records who added it. Never logged or returned.
- **E9.3 — Consent & data minimization.** *(PRD: AI-3, NFR-3 · Size: S)*
  - AC: Explicit, revocable consent required before any data leaves the system; send only the normalized merchant (+ amount) — never account numbers, masks, or member identity; provider disclosed in consent copy.
- **E9.4 — Categorization integration & rule caching.** *(PRD: AI-1 · Size: M)*
  - AC: On import (extends E3.4) and as a "suggest category" action (extends E4.6/E5.2), the user's LLM suggests a category; user confirms. On confirm, write a `CategoryRule` so the same merchant is never sent twice. Graceful fallback on missing key / provider error.

---

## 10. Cross-Cutting Requirements (apply to every epic)

- **Visibility:** every data read goes through the E0.5 scope helper. No endpoint bypasses it.
- **Security:** encryption in transit/at rest; no bank credentials stored; audit sensitive actions (member/role/visibility changes, exports).
- **Privacy:** data export & deletion supported (foundational).
- **Testing:** unit + integration tests per story; visibility leakage tests are mandatory for any endpoint returning account/transaction data.
- **Accessibility & responsive:** all UI meets the E0.6 baseline.

---

## 11. Phase 1 Definition of Done (rollup)

All epics complete and integrated such that the [PRD §7 acceptance checklist] passes: a two-person household can sign up with MFA, invite a partner with a role, add accounts by uploading statements and/or manual entry with visibility controls, manage categories/sub-categories, run budgets with sub-categories and a sinking fund, and view an accurate shared dashboard with the household/personal toggle and default charts — securely on the responsive web app.
