# Railway — Beta / Test Environment

This guide stands up PFM's **beta/test environment** on [Railway](https://railway.app): the API, the
web client, and a Postgres database, deployed from the `main` branch. It runs with **full auth
enforcement** (`AUTH_GATE=true`) so it behaves like production — invitation-only signup, email
verification, and MFA.

> **Where this fits:** **Railway = beta/test** (fast, cheap, simple). **GCP = production later** (see
> [`gcp-hosting.md`](gcp-hosting.md)). Because everything is containerized, the *same* images run on
> both — Railway now, Cloud Run when you need production scale. Local development is separate and
> documented in [`development-setup.md`](development-setup.md).

## What gets deployed

| Service | Source | Notes |
|---|---|---|
| **API** (NestJS) | root `Dockerfile` | migrations run on startup; serves on `$PORT` |
| **Web** (Vite SPA) | `apps/web/Dockerfile` | static bundle; `VITE_API_URL` baked in at build |
| **Postgres** | Railway plugin | injects `DATABASE_URL` into the project |

File uploads use the container's **ephemeral** disk in beta (see [Limitations](#limitations--gotchas)).

---

## Prerequisites

- A Railway account with the `hkusingh/pfm` GitHub repo connected.
- A **Resend** account with a verified sending domain (beta needs real email — see
  [Step 6](#step-6--email-resend-required)).
- The Railway CLI for the one-time seed: `npm i -g @railway/cli` then `railway login`.

---

## Step 1 — Create the project & API service

1. **New Project → Deploy from GitHub repo →** select `hkusingh/pfm`.
2. Railway detects the root `Dockerfile` (`railway.json` pins it) and creates the **API** service.
3. Rename the service to `api` for clarity.

## Step 2 — Add Postgres

1. In the project: **+ New → Database → PostgreSQL**.
2. Railway provisions it and injects a `DATABASE_URL` variable shared in the project — the API picks it
   up automatically. No `directUrl` is needed (Railway Postgres has no PgBouncer in front, unlike Neon).

## Step 3 — Add the Web service

1. **+ New → GitHub Repo →** the same `hkusingh/pfm` repo (a second service from one repo).
2. Rename it to `web`.
3. In the web service's **Settings → Build**, set the **Dockerfile Path** to `apps/web/Dockerfile`
   (so it doesn't inherit the root `railway.json`, which targets the API).

## Step 4 — Generate secrets

Generate three random values locally:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"   # run 3×
```

for `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, and `ENCRYPTION_KEY`.

## Step 5 — Set environment variables

Railway can reference one service's domain from another with `${{ service.RAILWAY_PUBLIC_DOMAIN }}` —
use that to avoid hardcoding URLs and the chicken-and-egg between the two services.

**API service → Variables:**

| Variable | Value |
|---|---|
| `AUTH_GATE` | `true` |
| `NODE_ENV` | `production` |
| `JWT_ACCESS_SECRET` | _(generated)_ |
| `JWT_REFRESH_SECRET` | _(generated)_ |
| `ENCRYPTION_KEY` | _(generated)_ |
| `PUBLIC_APP_NAME` | `PFM` |
| `WEB_ORIGIN` | `https://${{ web.RAILWAY_PUBLIC_DOMAIN }}` |
| `RESEND_API_KEY` | _(from Resend — see Step 6)_ |
| `EMAIL_DOMAIN` | _(your verified Resend domain)_ |

**Web service → Variables:**

| Variable | Value |
|---|---|
| `VITE_API_URL` | `https://${{ api.RAILWAY_PUBLIC_DOMAIN }}` |

> `WEB_ORIGIN` must be the **exact** web origin (not `*`) — the API sets CORS `credentials: true`, and
> browsers reject `*` on credentialed requests. `VITE_API_URL` is baked into the web bundle **at build
> time**, so changing it requires a web redeploy.

## Step 6 — Email (Resend, required)

Because beta runs `AUTH_GATE=true`, testers must receive **invite links, email-verification, and MFA
codes**. Without working email, nobody can sign up.

1. Create a Resend API key; verify your sending domain in the Resend dashboard.
2. Set `RESEND_API_KEY` and `EMAIL_DOMAIN` on the **API** service (Step 5).

(If `RESEND_API_KEY` is unset, the API logs emails to stdout instead of sending — fine for a quick smoke
test, useless for real testers.)

## Step 7 — Deploy

Trigger a deploy of both services (push to `main`, or redeploy from the dashboard). Each API deploy runs
`prisma migrate deploy` before starting (root `Dockerfile` `CMD`), so schema changes apply
automatically. Watch **Deployments** for build logs and **Logs** for `API listening on port <PORT>`.
Railway calls `GET /health` to confirm readiness.

Public URLs look like `https://api-production-xxxx.up.railway.app` and
`https://web-production-xxxx.up.railway.app`.

## Step 8 — Seed the database (one time)

The seed creates the `RegistrationPolicy` row **and** the first site admin. **This is required** — with
`AUTH_GATE=true`, signup reads `RegistrationPolicy` and will error until it exists.

Run it once against the deployed API container (where the internal `DATABASE_URL` is reachable):

```bash
railway ssh --service api
# inside the container:
pnpm --filter @pfm/db seed
exit
```

(Alternatively, run `pnpm --filter @pfm/db seed` locally with `DATABASE_URL` set to the Postgres
plugin's **public** connection string from the Railway dashboard.)

This seeds `RegistrationPolicy = admin_invite` and the site admin `hksingh@gmail.com` (random
placeholder password).

## Step 9 — Bootstrap the admin & invite testers

1. Open the web URL → **Forgot password** for `hksingh@gmail.com` → set a real password (check the
   Resend inbox / logs for the link).
2. Log in (you'll enroll MFA on first login).
3. Go to **/admin** → invite testers by email. They receive an invite link and can sign up.

That's the full invite-only flow exercised end to end.

---

## Updating the deployment

Every push to `main` triggers a Railway rebuild of the connected services. Migrations run on each API
deploy. Keep the **API at a single instance** so concurrent containers don't race the same migration.

---

## Environment variables: local vs Railway beta

| Variable | Local (`.env`) | Railway beta |
|---|---|---|
| `AUTH_GATE` | `false` | **`true`** |
| `DATABASE_URL` | `postgresql://pfm:pfm@localhost:5432/pfm_dev` | injected by the Postgres plugin |
| `WEB_ORIGIN` | `http://localhost:5173` | `https://${{ web.RAILWAY_PUBLIC_DOMAIN }}` |
| `VITE_API_URL` (web) | _unset_ (uses `/api` dev proxy) | `https://${{ api.RAILWAY_PUBLIC_DOMAIN }}` |
| `RESEND_API_KEY` | unset (emails → stdout) | real key (emails sent) |
| Secrets | generated placeholders | real generated values |
| File storage | local disk | ephemeral container disk |

---

## Limitations & gotchas

- **Ephemeral file storage.** Uploaded statements live on the container disk and are **lost on every
  redeploy/restart**, and aren't encrypted at rest. Fine for throwaway testing; attach a Railway
  **Volume** (or wire GCS) if testers will upload statements you need to keep.
- **No backups.** The beta Postgres isn't backed up — treat its data as disposable.
- **Single API instance.** Migrate-on-startup is safe at 1 replica; if you scale the API up, move
  migrations to a pre-deploy step instead.
- **CORS.** If the browser console shows CORS errors, `WEB_ORIGIN` doesn't exactly match the web origin
  (scheme + host). Fix the API variable and redeploy.
- **Custom domains (optional).** Add them per service under **Settings → Networking**; then update
  `WEB_ORIGIN` and `VITE_API_URL` to the custom domains and redeploy.

## Custom domain (optional)

Map `app.<domain>` → the web service and `api.<domain>` → the API service (Settings → Networking → Add
domain; follow Railway's CNAME instructions). Update `WEB_ORIGIN` / `VITE_API_URL` accordingly and
redeploy the affected service.
