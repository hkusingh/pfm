# Defects Log

Tracks defects (bugs/regressions) found and fixed during development, with a brief
description and status. Sourced from commit history and agent session notes.
Keep this file up to date as new defects are found and resolved — append new entries
rather than rewriting existing ones, and avoid duplicating entries already listed here.

| # | Defect | Fix | Status |
|---|--------|-----|--------|
| 1 | API packages (`contracts`, `core`, `db`) had `noEmit: true`, so `tsc` produced no output; plus TS6133 unused-var and TS2742 inferred-type errors blocked a clean API typecheck. | Removed `noEmit: true` from package configs, fixed unused-var/inferred-type errors, gitignored compiled artifacts leaking into `packages/*/src/`. (`613b8ea`) | Fixed |
| 2 | Forgot-password / related auth endpoints leaked whether an email address existed in the system via differing responses. | Normalized responses so the endpoint behaves the same regardless of whether the email exists. (`1e20df6`) | Fixed |
| 3 | Merchant auto-classification rule matching broke across months: bank-generated reference tokens (date codes, sequence IDs) in merchant names (e.g. "WF HOME MTG 06/09" vs "WF HOME MTG 07/09") produced different rule keys for the same merchant. | `merchantRuleKey()` in `@pfm/core` strips trailing numeric bank reference tokens so recurring merchants resolve to the same rule key. (`167c85d`) | Fixed |
| 4 | Dashboard spending-over-time tooltip values displayed 100x too high (double cents→dollars conversion). | Corrected tooltip formatter to pass minor units directly to `fmtMinorShort`. (`42e1472`) | Fixed |
| 5 | Sign-out button did not appear on the dashboard — `NavShell` only rendered it once `userEmail` had loaded. | `NavShell` now shows the sign-out button whenever `onSignOut` is provided, independent of `userEmail` load state. (`3abd258`) | Fixed |
| 6 | Household invites failed entirely (HTTP 500) when the invite email failed to send, because `noreply@resend.dev` is not a valid Resend sandbox sender address. | Use `onboarding@resend.dev` as the sender when `EMAIL_DOMAIN=resend.dev`; invite creation now succeeds even if email delivery fails (logs the failure and returns `signupUrl` so it can be shared manually). (`c165de7`) | Fixed |
| 7 | Budgets page income section double-counted income: the `/income-summary` endpoint returns both the top-level "Income" category and its child categories (Salary, Bonus, Tax refund, etc.) as separate flat entries, inflating received/expected totals. | Budgets page filters out top-level income category IDs from the income items used for totals/display, falling back to all items only if no children exist. (Budgets page rebuild, `2f1bd57`) | Fixed |
| 8 | Budget amount and sinking-fund reserve balance number inputs defaulted to "0.00", so typing inserted digits after the existing "0.00" (e.g. typing "5" produced "0.005") instead of starting from empty. | Inputs now start empty (with a "0.00" placeholder) when the underlying value is zero, via `minorToInputOrEmpty()`; only prefill when editing an existing non-zero value. (`8ef9af5`) | Fixed |
| 9 | After rebasing the rebuilt Budgets page onto `main` (which had removed the page's `NavShell`/navigation wrapper in Epic 10), a leftover `navigate('/categories')` call referenced an undefined `navigate`, breaking the web typecheck. | Re-added `useNavigate` import and hook to `BudgetsPage.tsx`. (`b4e1495`) | Fixed |

## Open / Not Tracked

None currently — this log only contains resolved defects identified so far. Add new
rows above as defects are reported, and move them here (or mark "Open") if unresolved.
