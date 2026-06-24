# Session Handoff — Deployment, Email, Branding, Encryption

Captures decisions and open items from the deploy/branding/email work that aren't
otherwise obvious from the code. Read alongside `CLAUDE.md` and `IMPLEMENTATION_PLAN.md`.
Last updated: 2026-06-24.

## Deployment reality (supersedes the GCP-staging note where they conflict)

- **Hosting is Railway**, not GCP, for the current beta. Three services: `api`
  (Dockerfile `apps/api/Dockerfile`), `web` (Dockerfile `apps/web/Dockerfile`, static
  served by `serve`), and managed **Postgres**. Per-service config-as-code lives in
  `apps/api/railway.json` and `apps/web/railway.json`. The GCP runbook
  (`docs/gcp-hosting.md`) is still the *future* target, not what's live.
- Railway injects `$PORT` (8080). Prisma `migrate deploy` runs on api container start
  (see the Dockerfile CMD).
- **Custom domain:** `www.thesmartmunshi.com` (web) and `api.thesmartmunshi.com` (api),
  DNS at GoDaddy. The bare apex (`@`) is painful on GoDaddy (no apex CNAME) — prefer the
  `www` host + forwarding; don't fight the apex.
- **CORS is single-origin:** `apps/api/src/main.ts` allows exactly `WEB_ORIGIN`
  (with `credentials: true`). Only that one origin can log in; the railway-generated
  `*.up.railway.app` URL will be CORS-blocked in a browser — that's expected, use the
  custom domain. (A multi-origin version is easy if needed: split `WEB_ORIGIN` on commas.)
- **`VITE_API_URL` is build-time** — the web bundle bakes it in. Changing it requires a
  web rebuild, not just a var change.

## Email (Mailtrap HTTP API — NOT SMTP)

- **Railway blocks outbound SMTP ports**, so SMTP connections time out. `EmailService`
  (`apps/api/src/email/email.service.ts`) sends over **Mailtrap's HTTPS API (port 443)**
  via `fetch`, with a 15s fail-fast timeout. Resend worked earlier for the same reason
  (HTTPS API). Do not reintroduce SMTP/nodemailer on Railway.
- Env vars (api service): `MAILTRAP_API_URL`, `MAILTRAP_API_TOKEN`, `EMAIL_FROM`.
  Sandbox URL: `https://sandbox.api.mailtrap.io/api/send/<INBOX_ID>` (captures, no domain
  needed). Live URL: `https://send.api.mailtrap.io/api/send` (delivers; needs a verified
  domain). `thesmartmunshi.com` is verified for live sending.
- If the API vars are unset, emails are **logged to stdout** (dev fallback) — handy to grab
  reset links from api logs without working mail.
- `forgotPassword` no longer 500s/leaks on a mail failure (logs + returns generic response).
  The household-invite path still surfaces failures (intentional — the invite must reach
  the person).
- **Deliverability:** brand-new domain → Outlook/Gmail may junk early mail. Add a **DMARC**
  TXT (`_dmarc` → `v=DMARC1; p=none; rua=mailto:hksingh@gmail.com`) and have testers mark
  "not junk"/add the sender. SPF+DKIM are set by Mailtrap's domain verification.

## Branding

- Product name is **Smart Munshi**, env-driven: web `VITE_PUBLIC_APP_NAME`, api
  `PUBLIC_APP_NAME` (defaults to "Smart Munshi" in `apps/web/src/lib/appName.ts` and the
  api fallbacks). Do not hardcode it.
- Landing page = `LoginPage` wrapped by `AuthLayout`, which renders `{APP_NAME}` plus a
  logo (`apps/web/public/logo.svg`, also `favicon.svg`). Swap the SVG for a designed mark
  later; layout picks it up.

## Encryption at rest — current state vs. target

- **Storage level:** Railway encrypts Postgres volumes at rest (disk-level; protects
  against physical theft, not against DB-credential/app compromise).
- **App level today:** only **MFA secrets** are AES-256-GCM encrypted (`mfa.service.ts`,
  `ENCRYPTION_KEY`). Passwords are argon2-hashed; session/device/recovery tokens are hashed.
  **Everything else is plaintext** in Postgres.
- **Doc/code divergence to resolve:** `CLAUDE.md` guardrail 4 says "uploaded statement files
  stored encrypted" — they are **not** (see below). Either implement it or amend the guardrail.
- **Field-encryption priorities** (best-practice, from the schema review):
  - *Reversibly encrypt:* uploaded statement file bytes (top priority), `ImportFile.originalName`,
    `Account.mask`/`institution`; `Transaction.merchant`/`merchantNormalized` is highest-privacy
    but encrypting breaks dedup/rule-matching/reporting — usually left to access control; PII
    (`User.name`/`email`, invite emails) needs a blind-index pattern if encrypted; DoB when added;
    **BYOK AI keys = mandatory envelope/KMS encryption**.
  - *Hash (one-way):* `Invite.token` and `SignupInvite.token` are currently **plaintext** — a real
    gap; store SHA-256 like `Session.tokenHash`.
  - *Leave plaintext:* amounts/balances/currency/dates/IDs/categories/budgets (needed for
    aggregation). Watch `AuditLog.metadata` (may carry sensitive before/after values).

## Uploaded statement file storage

- Files are written to the **api container's local disk** (`LocalObjectStore`,
  `UPLOADS_PATH ?? ./uploads`) **unencrypted**. On Railway this is **ephemeral** — wiped on
  every redeploy (no volume mounted).
- The file is only read once, in **commit** (`store.get`), to re-apply the final CSV mapping
  chosen after preview. **Nothing reads it after commit.** So durable storage isn't actually
  required for current functionality.
- `deleteBatch` is DB-only (txns + batch + ImportFile cascade); it never touches the file, so
  delete works even if the file is already wiped. Two consequences: a redeploy *between*
  preview and commit makes commit fail ("Uploaded file not found"); and once storage is made
  durable, `deleteBatch` will orphan files (add a `store.delete`).
- **Open decision:** (A) stop persisting the file at all — most secure, matches actual usage;
  or (B) move to durable + encrypted object storage if statement retention (audit/re-map) is
  wanted. Not yet decided.

## Open to-do checklist

- [ ] `git push origin main` — local commits (Mailtrap HTTP email, brand name, logo) aren't pushed.
- [ ] Railway vars — web: `VITE_API_URL=https://api.thesmartmunshi.com`,
      `VITE_PUBLIC_APP_NAME=Smart Munshi` (then rebuild web). api:
      `WEB_ORIGIN=https://www.thesmartmunshi.com`, `PUBLIC_APP_NAME`, `EMAIL_FROM`,
      `MAILTRAP_API_URL`, `MAILTRAP_API_TOKEN`.
- [ ] Promote site admin: `UPDATE "User" SET "isSiteAdmin" = true WHERE email = 'hksingh@gmail.com';`
- [ ] Set `AUTH_GATE=true` on the api before inviting testers (was flipped false for testing).
- [ ] Add the **DMARC** TXT record at GoDaddy (deliverability).
- [ ] Hash `Invite.token` / `SignupInvite.token` (security gap).
- [ ] Decide statement-file storage (A discard vs B durable+encrypted); if B, add `store.delete`
      to `deleteBatch` and encrypt bytes before `store.put`.
- [ ] Epic 9 (BYOK AI) — implement with envelope/KMS encryption for keys; never log/return keys.
