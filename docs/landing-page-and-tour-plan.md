# Landing Page + Product Tour — Plan

A build spec for the public marketing landing page and an interactive, no-account product
tour. Planning only — to be implemented in VS Code (Claude Code). Read with `CLAUDE.md`,
`docs/phase1-spec.md` (personas + features), and `docs/SESSION-HANDOFF.md`.
Last updated: 2026-06-24.

## 1. Goals

- Convert an unauthenticated visitor by (a) communicating the product's value fast, and
  (b) letting them **experience it without an account** via a guided tour over realistic
  seeded data.
- Lead the message with **AI-driven, proactive insight and a 360° view of household
  finances**; reinforce **trust** (app-level encryption, safe data handling, no bank logins).
- Give returning users a frictionless **Log in** (top-right → modal).
- Stay honest about Phase-1 reality: invitation-only access, BYOK/optional AI, and which
  deeper "proactive insight" capabilities are roadmap vs live.

## 2. Locked decisions (from review)

| Decision | Choice |
|---|---|
| Login placement | **Top-right "Log in" button → modal** (full-width marketing behind it) |
| Visual style | **Light & airy** (white/soft-gray, navy + gold/teal accents) |
| Hero lead | **AI-driven proactive insight + 360° view** of one's finances |
| Primary CTA (newcomers) | **Take the product tour** (interactive demo); **Log in** secondary; no public signup |
| Trust callout | **App-level field encryption + safe data handling** explicitly surfaced |

Note: "Log in only" from the first pass is replaced by **the tour** as the newcomer action —
it gives non-account visitors something to do without opening public signup.

## 3. Audience & positioning

Primary: couples/families who want one shared, accurate view of their money **without the
busywork** — and who are drawn to AI-assisted insight. Personas from the PRD: **Priya**
(organizer/owner), **Arjun** (casual co-owner, wants privacy on his account), **Sam**
(member, limited).

**Core promise — kill the friction.** The two things that make these apps a chore are
(1) **getting the data in** (uploading statements) and (2) **sorting it out** (categorizing
every transaction). We remove both: **Plaid** auto-connects accounts (no more statement
uploads) and **AI** auto-categorizes (no more manual tagging). Manual statement upload stays
available (free tier) for people who prefer it.

**Hero copy (final — matches the wireframe):**
- **Headline:** *"Insights that keep you ahead of what life throws at you — without the busywork."*
- **Subhead:** *"The Smart Munshi brings every account into one 360° view and surfaces what's
  changing — so you act on insight, not data entry. Connect automatically\* and let AI take care
  of the rest."* (\* = coming soon)

Positioning line (vision): *"A proactive, 360° view of your household's money — connected
automatically and categorized by AI, so you see what's coming, not just what happened."*

> **Plaid status:** automatic bank connection (Plaid) is **on the near-term roadmap — shipping
> before the broader beta**. Market it as a core feature, but keep current invite-only beta copy
> honest (label "coming" where it isn't live yet). *Tiering/pricing is internal only — no prices
> or Free/Premium plans on the site (see §6D); packaging comes later, after beta.*

## 4. Page information architecture (single scroll)

1. **Header / nav** — logo (left), anchor links (Product, How it works, Security, Use cases),
   **Log in** button (top-right, opens modal). Sticky, condenses on scroll.
2. **Hero** — headline + subhead (final copy in §3); primary CTA **"Take the tour"**,
   secondary **"Log in"**; supporting visual = the dashboard 360° view (real demo screenshot or
   live mini-embed). Small trust line under the CTAs ("Encrypted • MFA • Bank-level security").
3. **Trust strip** — 3–4 compact badges: *App-level encryption (AES-256-GCM)*, *Mandatory MFA*,
   *Bank-grade connections (Plaid) — we never store your bank password*, *You control your data*.
4. **Friction-killer** (the hook) — *"Stop uploading statements and tagging transactions."* Two
   columns: **Automatic import** (connect accounts via Plaid — no more CSV/PDF uploads) and
   **AI categorization** (transactions sorted for you — no more manual tagging). Note the manual
   upload path remains for those who want it.
5. **Benefit sections** (alternating image/text):
   - **360° view across the household** — every account in one shared view; per-account
     visibility (shared / private / balance-only) so each person keeps control.
   - **Automatic, AI-assisted categorization** — natively-built AI plus optional **BYOK** sorts
     transactions and surfaces patterns; learns your corrections. (Frame deeper predictive
     insight as the direction; only demo what's live.)
   - **Budgeting that handles real life** — monthly budgets with sub-categories **and
     amortized "sinking funds"** for big annual bills (insurance, property tax, travel).
   - **Connect your way, kept secure** — link banks automatically via **Plaid** (we never see or
     store your bank password — Plaid handles auth) **or** upload statements manually; sensitive
     data is encrypted at the application layer and protected by MFA. Never sold.
   - **Built for how households actually work** — multi-currency per account (USD/EUR/GBP/INR),
     roles (owner / co-owner / member), invite your partner; **investment accounts** (coming).
6. **What's coming** (optional light teaser) — a short roadmap mention of upcoming capabilities
   (automatic bank sync via **Plaid**, deeper **AI** insight, **investment accounts**). **No
   pricing and no Free/Premium tiers on the site** — packaging/pricing is decided much later,
   after thorough beta and testing. Tease the *features* as "coming," not the plans.
7. **How it works** (3 steps) — *Connect accounts (auto via Plaid, or import)* → *AI organizes &
   you budget* → *See insights & stay ahead.*
8. **Use cases** (persona cards) — *Couples with joint + separate money* (shared view + private
   accounts), *Families planning for big annual expenses* (sinking funds), *Multi-currency /
   expat households*, *Busy people who want it automatic* (Plaid + AI).
9. **Security deep-cut** — short section expanding the trust strip: what's encrypted at the
   field level, encryption in transit + at rest, MFA, **bank connections are tokenized via Plaid
   (no stored bank passwords)**, BYOK keys never logged/returned, visibility scoping. (See §8 —
   must match what's actually implemented.)
10. **Tour callout** — full-width band: *"See it with real-looking data — no account needed,"*
    button **"Start the tour."**
11. **Final CTA + footer** — repeat tour/login; footer with 4 columns: brand + tagline | Product (Overview, How it works, Security) | Company (About, Privacy) | Get started (Log in, Take the tour). **No pricing, no Contact link.**

## 5. Login modal

- A **"Log in" button** in the header opens a centered modal (focus-trapped, ESC/overlay to
  close, scroll-locked). Reuse the existing `LoginPage` form logic — extract the form into a
  `LoginForm` component used by both the modal and the standalone `/login` route, so behavior
  (MFA challenge, errors, forgot-password link) stays identical.
- Links inside: *Forgot password* → `/forgot-password`; no public "Sign up" (invite-only) — if
  desired, a muted "Have an invite? Accept it here" line.
- Authenticated users hitting `/` redirect to `/dashboard`; the landing is public-only.

## 6. Product tour (no account)

Two viable approaches — **recommended: the live demo-session approach** since you explicitly
want to populate the DB and show the real product.

### 6A. Recommended — read-only demo session over seeded data
- **Demo household** seeded with fictional, clearly-labeled data (see §7).
- A public endpoint `POST /auth/demo` issues a **short-lived, read-only** access token scoped
  to a **guest demo user** who is a member of the demo household. Reuse the existing visibility
  scope so the demo user only ever sees the demo household.
- A **server-side read-only guard** rejects all mutating routes for the demo user (defense in
  depth — never rely on the UI alone). Demo user cannot import, invite, export, or edit.
- Frontend: **"Take the tour"** calls `/auth/demo`, stores the demo token, and enters the real
  app (`AppShell` + real pages) in **demo mode**, with:
  - a persistent **demo banner**: *"You're exploring a live demo with sample data — Log in /
    Request access,"*
  - a **guided overlay** (step tooltips) walking the stops in §6C,
  - mutating controls hidden/disabled.
- **Reset**: re-seed on a schedule (or on each demo session start, in an isolated copy) so any
  accidental state is wiped and data stays pristine.

### 6B. Alternative — self-contained mock tour (no backend)
- A standalone `/tour` route renders tour screens from **static fixture JSON** (no API, no
  auth). Fully isolated, zero read-only-guard risk, faster to ship, but diverges from the real
  UI and won't reflect future changes. Use only if 6A proves too heavy for the beta.

### 6C. Tour stops (sequence)
1. **Dashboard — the 360° view** (net worth/cash snapshot, this-month spending).
2. **Accounts & privacy** (mixed account types + currencies; show shared/private/balance-only).
3. **Transactions & AI categorization** (auto/suggested categories from the BYOK assist).
4. **Budgets & sinking funds** (monthly budget + an amortized annual expense).
5. **Reports & insight** (spending by category, income vs expenses, period-over-period).
6. **Security & data handling** (callout overlay: field encryption, MFA, tokenized Plaid — no
   stored bank passwords).
7. **Convert** (Log in / Request access).

## 6D. Product tiering — INTERNAL context (NOT shown on the site)

For internal planning only — to guide in-app feature gating later. **Do not put pricing or a
Free/Premium comparison on the marketing site.** Pricing and packaging are decided much later,
after thorough beta and testing. The site may tease the *features* (Plaid, AI, investments) as
"coming," but never the plans/prices.

| Capability | Free | Premium |
|---|---|---|
| Account data in | **Manual statement upload** (CSV/OFX/QFX) | **Plaid auto-connect** + manual |
| AI categorization & insight | — (manual categorize) | **Native AI + BYOK** |
| Investment accounts | — | ✓ |
| Household features | Limited (limited members/features) | Full (roles, multi-member, etc.) |
| Budgets / sinking funds | Core | Full |

Notes: Plaid + native AI are **roadmap → before broader beta**, so on the site mark them
"coming" where not yet live. Implementation (later): a `tier` concept (per household or user)
plus server-side gating on Plaid/AI/investment endpoints. **This table never appears on the
site** — it only informs how features are gated in the app once tiering exists.

## 7. Demo data spec (fictional, multi-feature)

Seed one demo household that exercises every tour stop. All names/values fictional and labeled.

- **Household:** e.g. "The Sharma Family Demo," base currency USD, with INR/GBP accounts to show
  multi-currency. Members: Priya (owner), Arjun (co-owner), Sam (member).
- **Accounts:** checking, savings, credit card, one investment; at least one **private** and one
  **balance-only** to demonstrate visibility; mixed currencies.
- **Transactions:** ~6–12 months across realistic categories (groceries, dining, utilities,
  rent/mortgage, subscriptions, travel, income, transfers); include a few inter-account transfers
  to show transfer linking; a handful showing AI-suggested categories.
- **Categories & rules:** the default tree + a couple of category rules.
- **Budgets:** current + a couple of prior months (so period comparison has data).
- **Sinking funds:** 2–3 (e.g., car insurance — annual, vacation, property tax) to show
  amortization and reserve balances.
- **Saved charts/reports:** net worth trend, income vs expenses, spending by category.

### 7.1 Seeding MUST go through the encryption layer
Now that sensitive fields are encrypted at the app level, **raw SQL / plain Prisma inserts will
write unreadable or invalid data** for encrypted columns. The demo seed must encrypt those fields
**exactly the way the app does**. The app encrypts via `EncryptionService`
(`apps/api/src/common/encryption.service.ts`): AES-256-GCM with **per-context key derivation
(HKDF, context = householdId)** plus an `hmac()` blind index (e.g. `merchantRuleHash`).

Two requirements for the seed:
1. **Make the cipher logic importable by the standalone seed.** `seed-demo.ts` runs **outside**
   NestJS DI and lives in `packages/db`, while `EncryptionService` lives in `apps/api` — a
   library importing from an app is the wrong direction. Move the core `encrypt/decrypt/hmac`
   into a **shared module** (`packages/db` or `packages/core`) and have `EncryptionService` wrap
   it, so both the app and the seed use one implementation. *(Note: `mfa.service.ts` still has a
   separate older `encrypt/decrypt` — optional cleanup to consolidate onto `EncryptionService`.)*
2. **Use the correct context per field.** Encrypt every field with the **same context (the demo
   household's id)** the app uses to read it, and reproduce `hmac()` for blind-index columns —
   otherwise the app's decrypt throws a GCM auth-tag error and rule matching breaks.

The seed should be **idempotent**, gated by an env flag (e.g. `SEED_DEMO=true`) or an admin
action, and use the same `ENCRYPTION_KEY` as the target environment.

### 7.2 Screenshots / marketing imagery — capture with Playwright

Landing imagery should be **real app screens rendered against the seeded demo data** (§7), not
stock or hand-drawn mockups — so the demo seed is a prerequisite (it powers both the tour and the
screenshots).

- **Capture script (Playwright):** log in as the demo user (or use the `/auth/demo` token), set a
  fixed viewport (e.g. **1440×900 at deviceScaleFactor 2** for retina crispness), hide the demo
  banner, visit each tour-stop route — `/dashboard`, `/accounts`, `/transactions`, `/budgets`,
  `/reports` — and write one PNG per screen. **Repeatable:** rerun to refresh whenever the UI
  changes (no stale images).
- **Output:** `apps/web/public/marketing/` (or similar); swap into the `[ … screenshot ]`
  placeholders in the wireframe.
- **Polish:** consistent light-theme viewport, crop to the relevant panel, optional device frame.
- **Run locally** against the local dev app + demo seed (see Build workflow in §12); commit the
  generated PNGs so the deployed site ships with them.

## 8. Security & trust messaging (must match implementation)

Only claim what's true (encryption work is now committed + migrated). Verify each line against the
code before publishing:
- **Field-level encryption (AES-256-GCM)** of sensitive data at the application layer.
- **Encryption in transit and at rest** (TLS; Railway disk-level at-rest).
- **Mandatory MFA** for every account.
- **Tokenized bank connections (Plaid)** — *once live:* connect via Plaid, which handles bank
  auth; **we never see or store your bank password**. Until Plaid ships, accounts are added by
  upload/manual entry — don't claim live Plaid before it exists.
- **Per-account visibility** controls; household data is scoped per member.
- **BYOK AI** is optional; your key is never logged or returned, and only normalized
  merchant+amount is sent when you opt in.
Keep claims specific and defensible; avoid absolute promises ("unhackable," "100% secure").

## 9. Visual & design system (light & airy)

- **Palette:** background white / `#F8FAFC`; primary text navy `#1B3242` (brand); accents gold
  (`~#C9A227`) and teal/blue from the emblem; success/positive greens used sparingly for finance.
- **Type:** clean sans (e.g. Inter); large confident hero, generous line-height, lots of
  whitespace; rounded-2xl cards with soft shadows.
- **Logo:** `thesm-logo-light.png` (dark-text, transparent bg) is already in
  `apps/web/public/` and embedded in the wireframe header. Use it at 50 px tall in the sticky
  nav. No new asset needed. ✅
- **Imagery:** real product screenshots from the seeded demo (preferred) over generic stock.
- Reuse brand emblem (`thesm-mark.png`) for compact spots/section bullets.

## 10. Responsive, a11y, SEO, analytics

- **Responsive:** mobile-first; hero stacks; nav collapses to a menu; tour overlay adapts (bottom
  sheet on mobile).
- **Accessibility:** focus-trapped modal, keyboard-navigable tour, alt text, color-contrast
  (light theme must keep text ≥ AA on white), reduced-motion support.
- **SEO/meta:** title/description, Open Graph image (the lockup), favicon already set.
- **Analytics events:** `tour_started`, `tour_step_viewed`, `tour_completed`, `login_opened`,
  `login_succeeded`, `request_access_clicked` (if a request-access path is added later).

## 11. Routing & component breakdown (for Claude Code)

- **Routing:** `/` = public `LandingPage` (redirect authed users to `/dashboard`); keep
  `/login` standalone; tour at `/tour` (or enter demo mode in-place via `/auth/demo`).
- **New components (web):** `LandingPage` (+ section components: `Hero`, `TrustStrip`,
  `BenefitSection`, `HowItWorks`, `UseCases`, `SecuritySection`, `TourCallout`, `Footer`),
  `LoginModal`, refactor `LoginForm` out of `LoginPage`, `DemoBanner`, `TourOverlay`/steps.
- **API:** `POST /auth/demo` (read-only demo token), read-only guard for the demo user.
- **DB:** `seed-demo.ts` using the shared encryption helper; env-gated.
- **Reuse:** existing `AppShell`, pages, `NavShell`, `AuthLayout`/auth logic, `@pfm/ui`.

## 12. Build checklist

**Build workflow — local-first, then Railway.** Do all of this in the **local dev environment
first**: seed the demo household locally (`SEED_DEMO=true` against the local DB), build the
landing + tour, capture screenshots locally, and verify the whole flow (login modal, tour,
responsive, security claims). **Only then push to Railway** and run the demo seed against the
Railway DB. Don't develop the landing/tour or seed demo data directly on Railway.

- [ ] Decide tour approach: **6A live demo session** (recommended) vs 6B mock.
- [x] Logo: dark-text variant for the light theme ✅ (`apps/web/public/thesm-logo-light.png`).
- [ ] Add **Friction-killer** section (Plaid auto-import + AI categorization); optional light
      **"what's coming"** roadmap teaser. **No pricing / no Free-vs-Premium on the site.** Mark
      Plaid/AI/investments "coming" until live.
- [ ] Move `EncryptionService`'s `encrypt/decrypt/hmac` into a shared module both the app and the
      seed import; write env-gated `seed-demo.ts` that encrypts each field with the correct
      `context` (demo householdId) — see §7.1.
- [ ] Build the demo household dataset (§7) covering all tour stops.
- [ ] `POST /auth/demo` + server-side read-only guard for the demo user.
- [ ] Refactor `LoginForm` out of `LoginPage`; add `LoginModal` + header button.
- [ ] Build `LandingPage` sections (§4) with light design system (§9).
- [ ] Tour overlay + demo banner; wire "Take the tour" → `/auth/demo` → demo mode (§6C).
- [ ] **Playwright screenshot capture script** (§7.2) → generate real screens from the local demo;
      swap into the wireframe's `[ … screenshot ]` placeholders; commit the PNGs.
- [ ] Verify every security claim (§8) against code before publishing.
- [ ] Routing: public `/`, authed redirect to `/dashboard`; analytics events.
- [ ] Responsive + a11y pass; demo reset mechanism.
- [ ] **Verify end-to-end locally, then push to Railway** and run `SEED_DEMO` against the Railway DB.

## 13. Open questions

- Tour approach 6A vs 6B (recommend 6A).
- Do we want a lightweight **"Request access"** capture after all (needs an endpoint/Sheet), or
  keep newcomers on tour + login only?
- How much "proactive AI insight" to show now vs label as roadmap (keep honest per §8).
- Demo reset cadence (per-session sandbox vs scheduled re-seed).
