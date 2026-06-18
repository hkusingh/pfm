# Railway Deployment Guide

This guide covers deploying the PFM API and database to Railway.

## What gets deployed

| Layer | Target |
|-------|--------|
| API (NestJS) | Railway service — built from `Dockerfile` at repo root |
| Database | Railway PostgreSQL plugin — provisioned inside the same project |
| Web (Vite) | Not deployed here — still runs locally for Phase 1 |
| File storage | Local disk inside the container for Phase 1 (ephemeral); Phase 2 adds GCS |

---

## Step 1 — Create a Railway project

1. Go to [railway.app](https://railway.app) and sign in.
2. Click **New Project** → **Deploy from GitHub repo**.
3. Select the `hkusingh/pfm` repository.
4. Railway detects the root-level `Dockerfile` and uses it automatically.

---

## Step 2 — Add a Postgres database

1. Inside the project, click **+ New** → **Database** → **PostgreSQL**.
2. Railway provisions the database and automatically injects `DATABASE_URL`
   into the project's shared variables — the API picks it up with no extra config.

---

## Step 3 — Generate secrets

Run this command three times locally (once per secret) to generate cryptographically
random values:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

You need three values:
- `JWT_ACCESS_SECRET`
- `JWT_REFRESH_SECRET`
- `ENCRYPTION_KEY`

---

## Step 4 — Set environment variables

In the Railway dashboard, open the API service → **Variables** tab and add:

| Variable | Value |
|----------|-------|
| `AUTH_GATE` | `true` |
| `JWT_ACCESS_SECRET` | _(generated above)_ |
| `JWT_REFRESH_SECRET` | _(generated above)_ |
| `ENCRYPTION_KEY` | _(generated above)_ |
| `PUBLIC_APP_NAME` | `PFM` |
| `WEB_ORIGIN` | `*` |

**Optional:**

| Variable | Notes |
|----------|-------|
| `RESEND_API_KEY` | If not set, emails are printed to Railway logs instead of sent |
| `EMAIL_DOMAIN` | Required if `RESEND_API_KEY` is set |
| `GCS_BUCKET` | Skip for Phase 1 — file uploads use ephemeral local disk |

> `WEB_ORIGIN=*` allows all origins for now. Tighten this to your actual
> web/mobile URLs once they are deployed.

---

## Step 5 — Deploy

Railway builds the Docker image, runs `prisma migrate deploy` on startup,
then starts the API. The public URL will be in the format:

```
https://pfm-api-production.up.railway.app
```

Check the **Deployments** tab for build logs and the **Logs** tab for runtime output.
A successful start prints:

```
API listening on port <PORT>
```

Railway also calls `GET /health` every 30 seconds — a `200` response confirms
the service is healthy.

---

## Step 6 — Create the first site-admin account

With `AUTH_GATE=true`, signup requires an invite. Bootstrap the first admin:

1. Temporarily set `AUTH_GATE=false` in Railway Variables.
2. Hit `POST <API_URL>/auth/signup` with your email and password.
3. Log in, then promote your account to site-admin via the database
   (set `isSiteAdmin = true` on your `User` row in the Railway Postgres console).
4. Flip `AUTH_GATE` back to `true`.

From that point, use the Admin UI (`/admin/invites`) to invite all other users.

---

## Updating the deployment

Every push to `main` triggers a new Railway build automatically (if GitHub
integration is enabled). Migrations run on each deploy before the API starts,
so schema changes are applied without manual intervention.

---

## Local vs Railway environment variables

| Variable | Local (`.env`) | Railway |
|----------|---------------|---------|
| `DATABASE_URL` | `postgresql://pfm:pfm@localhost:5432/pfm_dev` | Injected by Railway Postgres plugin |
| `AUTH_GATE` | `false` | `true` |
| `WEB_ORIGIN` | `http://localhost:5173` | `*` (or specific origins) |
| Secrets | Any placeholder values | Real generated secrets |
