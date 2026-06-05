# Personal Finance Manager — Phase 1 Product Spec (PRD)

**Prepared for:** Harsh
**Date:** June 4, 2026
**Version:** 0.1
**Status:** Draft for review

---

## 1. Overview

### 1.1 Purpose
This document specifies the Phase 1 (MVP) scope of the Personal Finance Manager: a household-first web application that gives families a single, trustworthy, shared view of their money and an accurate budgeting experience.

> **Phase 1 is a limited-user test release.** Data enters via **document/statement upload and manual entry only** — there is no live bank aggregation. **Plaid aggregation is deferred to Phase 2.**

### 1.2 Phase 1 goal
A two-person household can sign up securely, add accounts by uploading statements or entering them manually (with privacy controls), run a monthly budget (with sub-categories and amortized annual expenses), and see accurate shared spending — on the web.

### 1.3 In scope
Household & membership, mandatory MFA, **document/statement upload (CSV/OFX/QFX) + manual accounts**, per-account visibility, categories & sub-categories, monthly budgets, amortized (sinking fund) budgets, spending dashboard & default charts, transaction management, responsive web app.

### 1.4 Out of scope (later phases)
**Live bank aggregation (Plaid) — Phase 2.** Also: AI insights & conversational agent, net worth/investments, goals & planning, custom chart builder, native mobile apps, external chat channels (Telegram/WhatsApp), passkeys, real-account mapping for sinking funds, PDF statement parsing. Foundational AI categorization (on imported data) runs behind the scenes but has no user-facing surface in Phase 1.

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
  - AC: Household has a name (editable), base currency, and month-start setting.
  - AC: The creating user is Owner (a co-owner with non-removable status).
- **H-2 Invite member.** Owner/co-owner can invite by email and select a role (**Co-owner** or **Member**) at invite time.
  - AC: Invite email contains a unique, expiring link.
  - AC: Pending invites are visible with status; can be resent or revoked.
- **H-3 Join household.** Invitee creates their own login (separate credentials) and joins the existing household.
  - AC: Invitee never shares the inviter's login.
  - AC: On join, invitee sees the shared household view per their permissions.
- **H-4 Roles (configurable).**
  - **Co-owner:** edit shared budgets/categories, invite/remove members, change household settings, manage own accounts.
  - **Member:** view shared household data; manage only their own accounts & visibility; cannot change household settings or manage others.
  - AC: Owner/co-owner can change a member's role later.
  - AC: A household must always have at least one Owner/co-owner.
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

- **S-1 Account auth.** Email + password signup with verification.
  - AC: Passwords stored hashed (industry standard); email verified before full access.
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

**Business rules**
- Visibility defaults: joint/shared-type accounts default to Shared; individual accounts default to Private.
- Household totals respect each account's visibility setting.

**Edge cases**
- Statement file unmatched with confidence → user must choose target account before import proceeds (no silent guessing).
- Re-importing an overlapping statement → de-dup skips already-present transactions.
- Multi-account statement file → prompt to split or import the matching account only.

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
- **D-4 Transactions list.** Searchable, filterable list across accessible accounts; supports recategorize and rule creation (per C-6).

> Note: the custom chart builder and net worth charts are Phase 2.

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
| Roles | Configurable co-owner vs. member |
| Auth | Mandatory MFA (Google Authenticator + email); passkeys later |
| Annual expenses | Amortized sinking funds; virtual reserves only |
| Connectivity (Phase 1) | Document/statement upload + manual entry; **no live aggregation** |
| Connectivity (Phase 2) | **Plaid** aggregator (no stored credentials) |
| Charts | Default dashboards in Phase 1; custom builder Phase 2 |
| Platform | Web-first; native mobile later |

---

## 6. Open Items for This Spec

- **Plaid deferred to Phase 2 (confirmed).** Phase 1 is a limited-user test using document upload + manual entry; data structures are built to accommodate a Plaid source later without rework.
- **Spending-over-time default: 6 months (confirmed)**, with a 3M/6M toggle on the Dashboard card.
- **Household model: one household per user in Phase 1 (confirmed)** — a household may still have multiple members. Design the data model to allow many-to-many later (membership as a join entity, accounts scoped to a household, not directly to a user) so multi-household becomes a switcher UI + relaxed constraint rather than a re-architecture.
- Monetization (tiers/pricing) — can be finalized in parallel; does not block build.

---

## 7. Acceptance: Phase 1 "Done"

Phase 1 is complete when a two-person household can:
1. Sign up, verify email, and enroll in MFA.
2. Invite a partner who joins with their own login and an assigned role.
3. Add accounts by uploading statements and/or manual entry, with per-account visibility set.
4. Maintain categories and sub-categories, including safe deletion.
5. Run monthly budgets with sub-categories and at least one amortized sinking fund.
6. View an accurate shared spending dashboard with the household/personal toggle and default charts.
7. Do all of the above securely on the responsive web app.
