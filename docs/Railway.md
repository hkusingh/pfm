# Railway — Beta / Test Environment

Stands up PFM's **beta/test environment** on [Railway](https://railway.app): three services — the
**api** (NestJS), the **web** (Vite SPA), and **Postgres** — deployed from the `main` branch with full
auth enforcement (`AUTH_GATE=true`), so it behaves like production (invite-only signup, email
verification, MFA).

> **Where this fits:** **Railway = beta/test** (fast, cheap). **GCP = production later**
> ([`gcp-hosting.md`](gcp-hosting.md)). Everything is containerized, so the *same* images run on both.
> Local development is separate — see [`development-setup.md`](development-setup.md).

## What gets deployed

| Service | Builds from | Railway config | Notes |
|---|---|---|---|
| **api** | `apps/api/Dockerfile` | **`apps/api/railway.json`** | migrations run on startup; serves `/health` on `$PORT` |
| **web** | `apps/web/Dockerfile` | **`apps/web/railway.json`** | static SPA via `serve`; `VITE_API_URL` baked in at build |
| **Postgres** | Railway plugin | — | injects `DATABASE_URL` into the project |

**Per-service config (important):** both app services build from the same repo, and Railway reads its
config-as-code (`railway.json`) **per service** — it overrides dashboard build settings. So each app
owns its own config, colocated with its code:

- **api** → `apps/api/railway.json` → builds `apps/api/Dockerfile`
- **web** → `apps/web/railway.json` → builds `apps/web/Dockerfile`

There is **no root `railway.json`**. Each service must have its **Config-as-code path** set to its own
file (Step 2). If a service has no config path set, Railway falls back to looking for a root config /
Nixpacks and builds the wrong thing — the classic symptom is the web service building the API image and
failing at start with `No projects matched the filters in '/app'`.

> **`dockerfilePath` is relative to the repo root**, not to the config file — e.g. `apps/api/Dockerfile`.
> The build **context** is the repo root (Root Directory left blank), so each Dockerfile can `COPY` the
> shared `packages/*` and the lockfile. The Dockerfile's *location* and the build *context* are
> independent.

---

## Prerequisites

- A Railway account with the `hkusingh/pfm` GitHub repo connected.
- A **Resend** account with a verified sending domain (beta needs real email — [Step 8](#step-8--email-resend-required)).
- The Railway CLI for the one-time seed: `npm i -g @railway/cli` then `railway login`.

---

## Setup (from scratch, in order)

The order matters — Railway only persists the auto-detected app services when you **Deploy** them on
the first screen; if you navigate away (e.g. to add a database) first, the staged service cards are
discarded.

### Step 1 — Create the project and deploy the app services

1. **New Project → Deploy from GitHub repo →** `hkusingh/pfm`.
2. Railway detects the monorepo and shows two cards: **`@pfm/api`** and **`@pfm/web`**.
3. **Click Deploy on this screen first** so both services are created and persisted. (Don't add the
   database yet.)

### Step 2 — Rename and configure the two services

1. Rename the services to **`api`** and **`web`** (Settings → service name, or double-click the card).
   The plain names are required for the cross-service variable references below
   (`${{ api.* }}` / `${{ web.* }}` — the `@pfm/...` names break that syntax).
2. **Set each service's Config-as-code path** (Settings → Config-as-code / "Railway Config File"):
   - **api → `apps/api/railway.json`**
   - **web → `apps/web/railway.json`**

   This is what makes each service build its own Dockerfile. Clear any manual "Dockerfile Path" you set
   earlier — the config file takes precedence. (Both services need this set — there is no root config to
   fall back on.)
3. Confirm **both** services have **Root Directory = blank** (the repo root). The Dockerfiles copy
   sibling `packages/*` from the root, so an `apps/api` / `apps/web` root directory breaks the build.

### Step 3 — Add Postgres

**+ Create → Database → PostgreSQL** (or ⌘K/Ctrl+K → "Postgres"). It provisions on its own and exposes
a `DATABASE_URL` in the project. Railway's plain Postgres has no PgBouncer, so no `directUrl` is needed
here (that's a Neon/GCP concern only).

### Step 4 — Generate secrets

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"   # run 3×
```

for `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, and `ENCRYPTION_KEY`.

### Step 5 — Set environment variables

Use Railway's cross-service references so you don't hardcode URLs or hit a chicken-and-egg between the
two services.

**api → Variables:**

| Variable | Value |
|---|---|
| `AUTH_GATE` | `true` |
| `NODE_ENV` | `production` |
| `DATABASE_URL` | `${{ Postgres.DATABASE_URL }}` *(match the DB service's exact name)* |
| `JWT_ACCESS_SECRET` | _(generated)_ |
| `JWT_REFRESH_SECRET` | _(generated)_ |
| `ENCRYPTION_KEY` | _(generated)_ |
| `PUBLIC_APP_NAME` | `PFM` |
| `WEB_ORIGIN` | `https://${{ web.RAILWAY_PUBLIC_DOMAIN }}` |
| `RESEND_API_KEY` | _(from Resend — Step 8)_ |
| `EMAIL_DOMAIN` | _(your verified Resend domain)_ |

**web → Variables:**

| Variable | Value |
|---|---|
| `VITE_API_URL` | `https://${{ api.RAILWAY_PUBLIC_DOMAIN }}` |

> `WEB_ORIGIN` must be the **exact** web origin (scheme + host) — the API sets CORS `credentials: true`,
> and browsers reject `*` on credentialed requests. `VITE_API_URL` is baked into the web bundle **at
> build time**, so a change requires a web redeploy.

### Step 6 — Generate public domains

For **each** of api and web: **Settings → Networking → Generate Domain** (the free `*.up.railway.app`).
If prompted for a port, accept the detected one (the apps listen on `$PORT`). The cross-service
references in Step 5 only resolve once the domains exist. A custom domain is optional and can wait.

### Step 7 — Deploy and verify

Push to `main` (or redeploy from the dashboard). Each **api** deploy runs `prisma migrate deploy` before
starting (the `apps/api/Dockerfile` `CMD`), so schema changes apply automatically. Then:

- **api:** open `https://<api-domain>/health` → expect `200` with `{status, timestamp}`. If it's
  crash-looping, check the logs — almost always a missing/incorrect `DATABASE_URL`.
- **web:** open the web domain → the SPA should load and reach the API.

Keep the **api at a single instance** so concurrent containers don't race the startup migration.

### Step 8 — Email (Resend, required)

Because beta runs `AUTH_GATE=true`, testers must receive invite links, email-verification, and MFA
codes. Without email, nobody can sign up.

1. Create a Resend API key; verify your sending domain.
2. Set `RESEND_API_KEY` and `EMAIL_DOMAIN` on the **api** service. (If unset, the API logs emails to
   stdout — fine for a smoke test, useless for real testers.)

### Step 9 — Seed the database (one time)

Creates the `RegistrationPolicy` row **and** the first site admin. **Required** — with `AUTH_GATE=true`,
signup reads `RegistrationPolicy` and errors until it exists.

```bash
railway ssh --service api
pnpm --filter @pfm/db seed
exit
```

(Alternatively, run `pnpm --filter @pfm/db seed` locally with `DATABASE_URL` set to the Postgres
plugin's **public** connection string from the dashboard.) This seeds `RegistrationPolicy = admin_invite`
and the site admin `hksingh@gmail.com` (random placeholder password).

### Step 10 — Bootstrap the admin and invite testers

1. Open the web URL → **Forgot password** for `hksingh@gmail.com` → set a real password (check the
   Resend inbox / logs for the link).
2. Log in (you'll enroll MFA on first login).
3. Go to **/admin** → invite testers by email. They receive an invite link and can sign up.

---

## Updating the deployment

Every push to `main` rebuilds the connected services; migrations run on each api deploy.

---

## Environment variables: local vs Railway beta

| Variable | Local (`.env`) | Railway beta |
|---|---|---|
| `AUTH_GATE` | `false` | **`true`** |
| `DATABASE_URL` | `postgresql://pfm:pfm@localhost:5432/pfm_dev` | `${{ Postgres.DATABASE_URL }}` |
| `WEB_ORIGIN` | `http://localhost:5173` | `https://${{ web.RAILWAY_PUBLIC_DOMAIN }}` |
| `VITE_API_URL` (web) | _unset_ (uses `/api` dev proxy) | `https://${{ api.RAILWAY_PUBLIC_DOMAIN }}` |
| `RESEND_API_KEY` | unset (emails → stdout) | real key |
| Secrets | generated placeholders | real generated values |
| File storage | local disk | ephemeral container disk |

---

## How the Docker builds work (and the gotchas already fixed)

These are baked into the repo's Dockerfiles — documented here so they're not rediscovered:

- **Prisma schema copied before install.** `@pfm/db`'s `postinstall` runs `prisma generate`, which needs
  the schema during `pnpm install`. Both Dockerfiles `COPY packages/db/prisma` **before**
  `pnpm install`. (Symptom if missing: `Could not load schema from prisma/schema.prisma`.)
- **OpenSSL installed.** Prisma's engines need OpenSSL on `node:20-slim`; both Dockerfiles
  `apt-get install -y openssl`. (Symptom: `Prisma failed to detect the libssl/openssl version`.)
- **`@pfm/testing` has no build.** It's test-only infra consumed as raw TS (`main: ./src/index.ts`); its
  source isn't shipped to prod images. Its `build` script was removed so turbo never tries to build it.
  (Symptom if present: `@pfm/testing#build` runs `tsc`, finds no tsconfig, prints help, exits 1.)
- **Per-service Railway config** (`apps/api/railway.json` for api, `apps/web/railway.json` for web) so
  each service builds its own Dockerfile from the repo-root context.

---

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| Web build runs `@pfm/api` / `nest` / `prisma`, or starts with `No projects matched the filters in '/app'` | The web service's **Config-as-code path** isn't set to `apps/web/railway.json`, so it's not building the web Dockerfile (Step 2). Set it for **both** services (api → `apps/api/railway.json`, web → `apps/web/railway.json`). |
| API shows "online" but `/health` doesn't respond / crash loop | Missing `DATABASE_URL`. Add Postgres and set `DATABASE_URL = ${{ Postgres.DATABASE_URL }}`, then redeploy. |
| `Could not load schema from prisma/schema.prisma` during build | Pull latest `main` — the Dockerfiles copy `packages/db/prisma` before install. |
| `@pfm/testing#build` fails with tsc help output | Pull latest `main` — the testing `build` script was removed. |
| Browser CORS error | `WEB_ORIGIN` doesn't exactly match the web origin (scheme + host). Fix on the api and redeploy. |
| `${{ api.RAILWAY_PUBLIC_DOMAIN }}` empty | Generate the service's public domain first (Step 6). |
| Staged service cards disappeared after adding a DB | Deploy the app services **before** adding anything else (Step 1). |

---

## Limitations & gotchas

- **Ephemeral file storage.** Uploaded statements live on the container disk and are lost on every
  redeploy/restart, and aren't encrypted at rest. Attach a Railway **Volume** (or wire GCS) if testers
  upload statements you need to keep.
- **No backups.** Treat the beta Postgres data as disposable.
- **Single api instance.** Migrate-on-startup is safe at 1 replica; if you scale up, move migrations to
  a pre-deploy step.

## Custom domain (optional)

Map `app.<domain>` → the web service and `api.<domain>` → the api service (Settings → Networking → Add
domain; follow Railway's CNAME instructions). Update `WEB_ORIGIN` / `VITE_API_URL` to the custom domains
and redeploy.
