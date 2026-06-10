# Personal Finance Manager — Phase 1 Product Spec (PRD)

**Prepared for:** Harsh
**Date:** June 4, 2026
**Version:** 0.1
**Status:** Draft for review

---

## 1. Overview

### 1.1 Purpose
This document specifies the Phase 1 (MVP) scope of the Personal Finance Manager: a household-first web application that gives families a single, trustworthy, shared view of their money and an accurate budgeting experience.

> **Phase 1 is a limited-user, invitation-only test release.** Data enters via **document/statement upload and manual entry only** — there is no live bank aggregation. **Plaid aggregation is deferred to Phase 2.** Account creation is **invitation-only** (site admin invites; see §3.7). A thin **bring-your-own-key (BYOK) AI categorization** capability is included and always optional (see §3.8).

### 1.2 Phase 1 goal
A site-admin-invited, two-person household can sign up securely, add accounts by uploading statements or entering them manually (with privacy controls), run a monthly budget (with sub-categories and amortized annual expenses), and see accurate shared spending — on the web. Optionally, the household can supply its own AI provider key to assist categorization.

### 1.3 In scope
**Invitation-only account creation (site-admin-managed)**, household & membership, mandatory MFA, **document/statement upload (CSV/OFX/QFX) + manual accounts**, per-account visibility, categories & sub-categories, monthly budgets, amortized (sinking fund) budgets, spending dashboard & default charts, transaction management, **optional BYOK AI categorization**, responsive web app.

### 1.4 Out of scope (later phases)
**Live bank aggregation (Plaid) — Phase 2.** Also: the broader AI insights platform & conversational agent, net worth/investments, goals & planning, custom chart builder, native mobile apps, external chat channels (Telegram/WhatsApp), passkeys, real-account mapping for sinking funds, PDF statement parsing, and **open/public signup** (Phase 1 is invitation-only; household-to-household beta invites and general availability come later). *Note: unlike the original plan, a limited **user-facing** BYOK AI categorization surface is now in Phase 1 (§3.8) — but only as an optional, key-gated assist; AI insights/forecasting/coaching remain Phase 2.*

### 1.5 Personas (reference)
- **Priya** — co-owner / organizer; sets up the household, builds budgets, high engagement.
- **Arjun** — co-owner / casual; wants visibility with low effort and privacy on his own account.
- **Sam** — member / limited; sees the shared view, manages only own accounts.

---

## 2. Success Metrics

| Metric | Target (Phase 1) |
|---|---|
| Onboarding completion (signup → first account connected/imported) | ≥ 60% |
| Households with 2+ members | ≥ 40% of active households |
| Households with an active budget | ≥ 70% of active households |
| Week-4 retention | ≥ 35% |
| MFA enrollment | 100% (mandatory) |

---

## 3. Functional Requirements

Requirements use IDs (e.g. `H-1`). Each feature lists user stories and acceptance criteria (AC). "System" = the application.

### 3.1 Household & Membership

**User stories**
- As a new user, I can create a household and become its owner.
- As an owner/co-owner, I can invite people by email and assign a role.
- As an invitee, I can join with my own login and keep my own private space.

**Requirements & acceptance criteria**

- **H-1 Create household.** On first signup, the system creates a household with the signup user as **Owner**.
  - AC: Household has a name (editable), a **base currency (USD, EUR, GBP, or INR)**, and a month-start setting.
  - AC: The creating user is the **primary Owner** — a co-owner with non-removable status (modeled as `role:owner` + `isPrimaryOwner`).
- **H-2 Invite member.** Owner/co-owner can invite by email and select a role (**Co-owner** or **Member**) at invite time.
  - AC: Invite email contains a unique, expiring link.
  - AC: Pending invites are visible with status; can be resent or revoked.
- **H-3 Join household.** Invitee creates their own login (separate credentials) and joins the existing household.
  - AC: Invitee never shares the inviter's login.
  - AC: On join, invitee sees the shared household view per their permissions.
- **H-4 Roles (configurable).** Three product roles map onto `Membership.role` + `isPrimaryOwner`:
  - **Owner (primary):** the founder; same powers as co-owner but non-removable while sole owner (`role:owner`, `isPrimaryOwner:true`).
  - **Co-owner:** edit shared budgets/categories, invite/remove members, change household settings, manage own accounts (`role:owner`, `isPrimaryOwner:false`).
  - **Member:** view shared household data; manage only their own accounts & visibility; cannot change household settings or manage others (`role:member`).
  - AC: Owner/co-owner can change a member's role later. *(Role is a property of the membership, not the user — it is not chosen at account signup.)*
  - AC: A household must always have at least one owner (primary or co-owner).
- **H-5 Remove member.** Owner/co-owner can remove a member.
  - AC: Removed member loses access to shared data immediately.
  - AC: The removed member's own connected accounts and personal data are detached, not deleted from their side (see edge cases).

**Edge cases**
- Inviting an email that already has a PFM account → link account to this household after confirmation (a user may belong to only one household in Phase 1).
- Last remaining owner cannot be removed or demoted until another co-owner exists.
- Expired invite → invitee prompted to request a new one.

### 3.2 Authentication & Security

**User stories**
- As any user, I must secure my account with MFA before using the app.
- As a user, I can manage my password and MFA methods.

**Requirements & acceptance criteria**

- **S-1 Account auth.** Email + password + **name** signup, with email verification.
  - AC: Signup captures the user's display **name** (used in the member list and dashboard greeting); passwords stored hashed (industry standard); email verified before full access.
  - AC: **Date of birth is an optional profile field** (editable after signup, not required); when stored it is treated as sensitive PII (minimised exposure). Locale/timezone are optional profile fields.
- **S-2 Mandatory MFA.** MFA is required for **all** users and cannot be disabled (only the method can change).
  - AC: Setup is enforced during onboarding before reaching the app.
  - AC: Supported methods at launch: **Google Authenticator (TOTP)** and **email code**.
  - AC: User can set a primary and a backup method.
  - AC: Recovery codes are generated and shown once after setup.
- **S-3 Session security.** Sessions expire after inactivity; re-auth required on expiry.
- **S-4 Data protection.** Financial data encrypted in transit and at rest; access scoped to the authenticated user's permissions.
- **S-5 Privacy controls.** User can export their data and request account/data deletion.

**Edge cases**
- Lost MFA device → recovery via backup method or recovery codes.
- Failed MFA attempts → rate-limited / temporary lockout.

### 3.3 Accounts: Document Upload, Manual Entry & Visibility

> Phase 1 data path is **document upload + manual entry**. Live aggregation (A-7) is **Phase 2**.

**User stories**
- As a user, I can add an account by uploading a statement file.
- As a user, I can add a manual account and enter transactions by hand.
- As an account owner, I control who in the household sees each account.

**Requirements & acceptance criteria**

- **A-1 Document/statement upload (primary).** User uploads CSV/OFX/QFX. *(P0)*
  - AC: Column-mapping step maps file fields to Date / Merchant / Amount (remembered per source for repeat imports).
  - AC: File auto-suggests the target account (from detected account number/name); user confirms or picks; can create a new manual account.
  - AC: If the account can't be matched with confidence, the user must pick before commit (no silent assignment).
  - AC: Each file maps to exactly one account.
  - AC: Imported transactions are enriched/auto-categorized; user can correct.
  - AC: Duplicate transactions (overlapping with existing data in that account) are detected and skipped; counts reported (imported / skipped).
  - AC: Uploaded files are stored encrypted. (PDF statement parsing is out of scope for Phase 1.)
- **A-2 Manual account & transactions.** User can add a manual (cash/unsupported) account and add/edit transactions by hand. *(P0)*
- **A-3 Per-account visibility.** Owner sets each account to **Shared**, **Private**, or **Balance-only**.
  - AC: **Shared** — transactions and balance visible to the household.
  - AC: **Private** — invisible to others; excluded from shared totals unless set to balance-only.
  - AC: **Balance-only** — balance counts toward shared household totals; line items hidden.
  - AC: A user can set visibility only on their own accounts.
- **A-4 De-duplication.** Duplicate transactions across repeated imports (and, in Phase 2, across aggregation) are detected via a dedup hash and merged/skipped so nothing is double-counted.
- **A-7 Live aggregation via Plaid — _Phase 2_.** User links an institution through Plaid (own bank credentials; PFM never stores them); accounts, balances, and transactions sync automatically, with connection-health/reconnect handling. *Designed-for now; built in Phase 2.*
- **A-8 Per-account currency (no conversion).** Each account has its own currency; supported currencies are **USD, EUR, GBP, INR**. *(P0)*
  - AC: An account's currency defaults to the household base currency but may be set to any supported currency.
  - AC: **Amounts are never converted (no FX in Phase 1).** Budgets, budget-vs-actual, and blended household/dashboard roll-up totals are computed in the **base currency and include only base-currency accounts**.
  - AC: Accounts/transactions in a non-base currency are shown natively and in a separate per-currency breakdown; they are excluded from base-currency roll-ups (no silent blending).
  - AC: Amounts display with locale-aware formatting (correct symbol and grouping, e.g. ₹ lakh/crore for INR).

**Business rules**
- Visibility defaults: joint/shared-type accounts default to Shared; individual accounts default to Private.
- Household totals respect each account's visibility setting **and never mix currencies** (per A-8).

**Edge cases**
- Statement file unmatched with confidence → user must choose target account before import proceeds (no silent guessing).
- Re-importing an overlapping statement → de-dup skips already-present transactions.
- Multi-account statement file → prompt to split or import the matching account only.
- Account currency differs from base → its figures show natively and stay out of base-currency totals; no conversion is implied or performed.

### 3.4 Categories & Sub-categories

**User stories**
- As a co-owner, I can tailor the household's categories and sub-categories.
- As any user, I can recategorize transactions.

**Requirements & acceptance criteria**

- **C-1 Default categories.** Household starts with a sensible default set, including a protected **Income** category.
- **C-2 Manage categories.** Add, rename, recolor, reorder, and delete categories.
  - AC: Reachable from Budgets → "Manage categories."
  - AC: Core/system categories (e.g. Income) are protected and cannot be deleted.
- **C-3 Sub-categories.** Sub-categories nest under a parent and roll up to it in budgets and reports.
  - AC: Parent total = sum of its sub-categories plus any direct spend.
- **C-4 Income sub-categories.** Income supports sub-categories (e.g. per-earner salary, bonus, investment income).
  - AC: Income is tracked as **received vs. expected**, not as a spend cap.
  - AC: Income sub-categories respect account visibility (e.g. a balance-only salary still rolls up to total income without exposing line items).
- **C-5 Safe deletion.** Deleting a category that has transactions prompts the user to reassign or merge those transactions first.
  - AC: Deletion cannot orphan transactions.
- **C-6 Recategorize & rules.** User can change a transaction's category and optionally create a rule to auto-apply to that merchant going forward.

**Edge cases**
- Deleting a parent with sub-categories → prompt to handle children (reassign/merge) before deletion.
- Renaming a category preserves existing transaction assignments.

### 3.5 Budgets

**User stories**
- As a co-owner, I can set monthly budgets per category.
- As a household, I can budget for large annual expenses without monthly spikes.

**Requirements & acceptance criteria**

- **B-1 Monthly budgets.** Set a budget amount per category (and sub-category); track spent vs. remaining for the current period.
  - AC: Sub-category budgets roll up to the parent.
- **B-2 Budget visualization.** Budget bars show **magnitude** (bar length proportional to budget size) and **utilization** (fill = spent vs. budget), with near-limit and over-budget states.
  - AC: Sub-categories are collapsed by default and expand on demand.
- **B-3 Amortized (sinking fund) budgets.** Mark a recurring non-monthly expense (annual, semi-annual, quarterly) as amortized.
  - AC: System spreads the total evenly into a **virtual reserve** that accrues monthly.
  - AC: The monthly budget shows the set-aside amount; when the actual bill is paid it draws from the reserve rather than spiking that month.
  - AC: Reserve progress is shown (saved vs. target, next due date, behind/ahead state).
  - AC: Monthly view shows the amortized amount; yearly view shows the true total.
  - AC: **Virtual reserves only** in Phase 1 (no mapping to a real savings account).
- **B-5 Amortized vs. actual — display rule.** Amortization affects budgeting only, not spending.
  - AC: **Spending** (transaction list, spending-by-category, spending-over-time) always shows **actuals** — the real bill appears in the month it is paid.
  - AC: **Budgets** show the **amortized** set-aside; the actual payment draws from the accrued reserve so budget-vs-actual does not spike that month.
- **B-6 Mark reserve-funded payments.** When an actual transaction corresponds to an amortized (sinking-fund) item, it is linked to that item and marked.
  - AC: The matched payment is auto-detected and the user can confirm/override the link.
  - AC: The transaction shows a badge indicating it is a planned annual expense funded from its reserve (e.g. "Property tax · from reserve").
  - AC: In the spending-over-time chart (Actual view), the reserve-funded portion of that month is shown as a distinct, labeled segment so the spike is self-explaining.
- **B-7 Actual / Smoothed toggle — deferred to Phase 2.** The spending-over-time chart will offer an **Actual** view (real spike) and a **Smoothed** view (annual expenses spread evenly, matching the amortized budget). *Phase 1 ships the Actual view with reserve-funded marking (B-6); the toggle itself is Phase 2.*
- **B-4 Income tracking.** Income shows received vs. expected per income (sub-)category, not a spend limit.

**Business rules**
- Amortization method selectable per item: amortized (default for insurance/property tax) or actual (full hit in month paid).
- Mid-year start on a sinking fund → user choice to catch up gradually or front-load (Phase 1 default: gradual).

**Edge cases**
- Actual bill larger than the accrued reserve → flag a shortfall; remainder hits the current month's budget.
- Budget set on a parent and its children → children roll up; parent's direct budget covers non-sub spend.

### 3.6 Dashboard & Reports (Phase 1 subset)

**User stories**
- As any user, I can see the household's financial picture at a glance.
- As any user, I can switch between the household and my personal view.

**Requirements & acceptance criteria**

- **D-1 Dashboard.** Shows KPIs (income, spending, budget remaining), budget vs. actual, and default charts.
- **D-2 Household vs. personal toggle.** Switch between combined household and personal-only views.
  - AC: Personal view shows only the current user's own accounts; household view respects all visibility rules.
- **D-3 Default charts (Phase 1).** Spending by category, spending over time, income vs. expenses, budget vs. actual.
  - AC: Charts are interactive (hover shows amounts) and visibility-aware.
  - AC: Spending-over-time defaults to a **6-month** range (toggle: 3M / 6M).
  - AC: Spending charts show actuals (per B-5).
  - AC: **Currency-aware (per A-8):** KPIs/charts roll up in the base currency over base-currency accounts only; non-base-currency accounts appear in a separate per-currency breakdown, never blended or converted.
- **D-4 Transactions list.** Searchable, filterable list across accessible accounts; supports recategorize and rule creation (per C-6).
- **D-5 Period comparison report.** Compare spending **by category across two periods**, with selectable granularity: **month-over-month, quarter-over-quarter, or year-over-year**.
  - AC: User picks the granularity and the two periods (defaults: current vs. immediately preceding period; YoY offers the same period a year earlier).
  - AC: Shows, per category, the two periods' totals and the change (absolute and %), with a total row; categories expand to sub-categories.
  - AC: Visibility-aware and currency-aware (base-currency roll-ups only, per A-8); the report can be saved to the dashboard.

> Note: the custom chart builder and net worth charts are Phase 2. The period-comparison report (D-5) is a fixed, pre-built report — not the custom builder.

### 3.7 Access & Invitations (invitation-only)

> Phase 1 is a closed test: **only people the site admin invites can create an account.** This is platform-level access, separate from the household *member* invites in §3.1 (which add someone to an existing household).

**User stories**
- As the operator, I can invite specific people to join the platform and create their own household.
- As an invited person, I can create an account; uninvited people cannot.

**Requirements & acceptance criteria**

- **S-6 Invitation-only account creation.** A global registration policy controls signup: `admin_invite` (Phase 1 default), `beta_invite`, or `open`.
  - AC: In `admin_invite`, account creation requires a valid, unexpired signup invitation for that email, enforced server-side and consumed on use; no invitation → no account.
  - AC: A **site-admin** role (distinct from household owner/member) can issue, list, resend, and revoke signup invitations and view their status; the admin area requires site-admin + MFA.
  - AC: The first site admin is provisioned at setup (seeded), since none exists to invite the first.
  - AC: The policy is designed to switch later to `beta_invite` (existing households invite other households, with a quota) and then `open` (no invitation needed) — a configuration change, not a redesign.

**Edge cases**
- Invitation to an email that already has an account → cannot create a second account; resolve via the household member-invite flow instead.
- Expired/revoked signup invitation → blocked with a clear message; admin can resend.

### 3.8 Optional AI Categorization (BYOK)

> Optional, key-gated assist. **The product is fully usable with no AI configured.** The broad AI insights platform remains Phase 2.

**User stories**
- As an owner, I can add our household's own AI provider key (Claude / OpenAI / Gemini) so transactions are categorized with AI.
- As any user, I can accept or correct an AI-suggested category.

**Requirements & acceptance criteria**

- **AI-1 Provider-agnostic categorization.** With a configured key + consent, the system can suggest a category for a transaction (on import and on demand); the user confirms or overrides; a confirmed suggestion can create a merchant rule.
  - AC: Supported providers at launch: Anthropic (Claude), OpenAI, Google (Gemini); the choice is the household's.
  - AC: If no key is configured or the provider errors, the system falls back to rule-based/uncategorized — AI is never required.
- **AI-2 BYOK credential security.** The provider key is the household's own; PFM stores it encrypted (envelope encryption), never displays or logs it (shows only provider + last-4 + status), validates it on entry, and supports rotation/revocation.
  - AC: The key is scoped to the household, set by an owner; a record notes who added it.
- **AI-3 Consent & data minimization.** Sending transaction data to a third-party provider requires explicit, revocable consent; only the minimum needed (normalized merchant, and amount) is sent — never account numbers, masks, or member identity; the provider is disclosed in the consent.

**Edge cases**
- Consent revoked → AI suggestions stop immediately; existing categorizations are unaffected.
- Provider rate-limit/outage → graceful fallback; the user can still categorize manually.

---

## 4. Non-Functional Requirements

- **NFR-1 Platform.** Responsive web app (desktop + mobile browser).
- **NFR-2 Security.** Encryption in transit & at rest; mandatory MFA; least-privilege data access; no stored bank credentials.
- **NFR-3 Privacy/compliance.** Explicit, revocable consent for connections; data export & deletion; align with applicable privacy regulation (e.g. GDPR/CCPA). *Engage qualified counsel/security specialists before handling real financial data.*
- **NFR-4 Performance.** Dashboard loads within ~2s on a typical connection with a normal account set; transaction sync runs asynchronously.
- **NFR-5 Reliability.** Graceful handling of malformed import files and processing errors; clear error states. (Aggregator outage/reconnect handling arrives with Plaid in Phase 2.)
- **NFR-6 Accessibility.** Meet common accessibility standards (keyboard navigation, contrast, labels).
- **NFR-7 Auditability (foundational).** Record sensitive actions (member changes, visibility changes, exports) for future audit-log surfacing.

---

## 5. Key Decisions Embedded (from discovery)

| Area | Decision |
|---|---|
| Audience | Households/families first |
| Wedge | Budgeting & spending on top of aggregation |
| Sharing | Per-account: shared / private / balance-only |
| Totals | Configurable per account (balance-only option) |
| Membership | Invite-to-household; own logins; own-account connection only |
| Roles | Owner (primary) / co-owner / member — `Membership.role` + `isPrimaryOwner`; set at create/invite, not at signup |
| Currencies | USD / EUR / GBP / INR; **per-account currency, no FX conversion**; base-currency roll-ups only |
| Profile | Signup captures name (+ email/password); DoB optional (profile); locale/timezone optional |
| Auth | Mandatory MFA (Google Authenticator + email); passkeys later |
| Access | **Invitation-only** in Phase 1 (site-admin invites); beta = household-invites-household; then open GA |
| Annual expenses | Amortized sinking funds; virtual reserves only |
| Connectivity (Phase 1) | Document/statement upload + manual entry; **no live aggregation** |
| Connectivity (Phase 2) | **Plaid** aggregator (no stored credentials) |
| AI (Phase 1) | **BYOK** — household supplies its own Claude/OpenAI/Gemini key; optional, key-gated categorization assist |
| AI (Phase 2) | Full AI insights platform (forecasting, coaching, anomalies) |
| Charts | Default dashboards in Phase 1; custom builder Phase 2 |
| Hosting | Local-first during dev; serverless (GCP Cloud Run + Neon) when testers onboard; container-portable |
| Platform | Web-first (standalone API for future mobile/chat); native mobile later |

---

## 6. Open Items for This Spec

- **Plaid deferred to Phase 2 (confirmed).** Phase 1 is a limited-user test using document upload + manual entry; data structures are built to accommodate a Plaid source later without rework.
- **Spending-over-time default: 6 months (confirmed)**, with a 3M/6M toggle on the Dashboard card.
- **Household model: one household per user in Phase 1 (confirmed)** — a household may still have multiple members. Design the data model to allow many-to-many later (membership as a join entity, accounts scoped to a household, not directly to a user) so multi-household becomes a switcher UI + relaxed constraint rather than a re-architecture.
- **Invitation-only access (confirmed, 2026-06-10).** Phase 1 = `admin_invite`; built as a policy toggle that opens to a household-invites-household beta, then GA. Requires a site-admin role + admin area.
- **BYOK AI in Phase 1 (confirmed, 2026-06-10).** Optional, key-gated categorization using the household's own provider key; broader AI insights stay Phase 2. Security via envelope encryption; consent + data minimization required.
- **Deployment local-first (confirmed, 2026-06-10).** Validate locally; host on serverless (GCP Cloud Run + Neon) only when testers onboard. Keep the app container-portable and 12-factor so local→hosted is config, not code.
- Monetization (tiers/pricing) — can be finalized in parallel; does not block build.

---

## 7. Acceptance: Phase 1 "Done"

Phase 1 is complete when a **site-admin-invited** two-person household can:
1. Receive a signup invitation, create an account, verify email, and enroll in MFA (uninvited users cannot sign up).
2. Invite a partner who joins with their own login and an assigned role.
3. Add accounts by uploading statements and/or manual entry, with per-account visibility set.
4. Maintain categories and sub-categories, including safe deletion.
5. Run monthly budgets with sub-categories and at least one amortized sinking fund.
6. View an accurate shared spending dashboard with the household/personal toggle and default charts.
7. *(Optional)* Configure the household's own AI provider key, with consent, to get AI-suggested categories — while the app remains fully usable without it.
8. Do all of the above securely on the responsive web app.
