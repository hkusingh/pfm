# Local Development Setup

How to get a working PFM development + test environment on your machine. For the build plan and
conventions see [`../IMPLEMENTATION_PLAN.md`](../IMPLEMENTATION_PLAN.md) and
[`../CLAUDE.md`](../CLAUDE.md); for branch/merge rules see [`../CONTRIBUTING.md`](../CONTRIBUTING.md).

## Prerequisites

- **Node.js ≥ 20** — https://nodejs.org
- **pnpm** — `corepack enable` (ships with Node), or `npm install -g pnpm`
- **Docker** (with the Compose v2 plugin) — runs the local Postgres. Optional if you bring your own
  Postgres (see [Using your own Postgres](#using-your-own-postgres)).
- **openssl** — generates local secrets (preinstalled on macOS/Linux).

## Quick start (one command)

```bash
git clone git@github.com:hkusingh/pfm.git
cd pfm
./scripts/setup-dev.sh
pnpm dev
```

- API → http://localhost:3000
- Web → http://localhost:5173

`setup-dev.sh` is idempotent — re-run it any time. It performs the steps below for you.

## What `setup-dev.sh` does

1. **Checks prerequisites** (Node ≥ 20, pnpm, Docker, openssl).
2. **Creates `.env`** from `.env.example` if you don't have one, generating real values for
   `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, and `ENCRYPTION_KEY`, and setting **`AUTH_GATE=false`**
   (see [The AUTH_GATE flag](#the-auth_gate-flag)). An existing `.env` is left untouched.
3. **Starts Postgres** via `docker compose up -d postgres` and waits until it's ready. The container
   provisions two databases: `pfm_dev` and `pfm_test` (the latter via `scripts/init-test-db.sql`).
4. **Installs dependencies** with `pnpm install`.
5. **Generates the Prisma client** and applies committed migrations to **both** `pfm_dev` and
   `pfm_test` (`prisma migrate deploy`).
6. **Seeds** the registration policy (`admin_invite`) and the first **site admin**
   (`hksingh@gmail.com`).

After it finishes, `pnpm dev` runs the API and web client in watch mode.

## The `AUTH_GATE` flag

A single server flag (`apps/api/src/common/feature-flags.ts`) gates all auth friction so you can
develop against a local database without invites, email, or MFA:

| `AUTH_GATE` | Behaviour |
|---|---|
| `false` (local dev default) | Signup needs **no invitation**, email is **auto-verified**, and **MFA is not required**. You can create an account and reach the app immediately. |
| `true` (production / CI default) | Full enforcement: invite-only signup (`RegistrationPolicy` + `SignupInvite`), email verification, and mandatory MFA. |

The flag only toggles **whether** these checks run — the enforcement code is always present.

- The committed `.env.example` ships `AUTH_GATE=true` (secure default).
- `setup-dev.sh` sets `AUTH_GATE=false` in your local `.env`.
- **It must be `true` in every deployed and CI environment.** Never commit `AUTH_GATE=false`.

To exercise the real invite/MFA flow locally, set `AUTH_GATE=true` in `.env`, restart the API, then
issue yourself a signup invite from the admin area (the seeded site admin can do this once it has a
password — see below).

## Environments

PFM uses one codebase across two environments that differ **only by configuration**, never by code:

| | **Local dev** (this guide) | **Beta / test** ([Railway.md](./Railway.md)) | **Production** (later, [gcp-hosting.md](./gcp-hosting.md)) |
|---|---|---|---|
| Purpose | fast iteration | invited testers | real users |
| `AUTH_GATE` | `false` (no invite/MFA) | `true` (invite-only + MFA) | `true` |
| Host | your machine | Railway (API + web + Postgres) | GCP Cloud Run + Neon |
| Email | logged to stdout | real (Resend) | real (Resend) |
| Secrets | generated placeholders in `.env` | Railway service variables | GCP Secret Manager |
| Deploys from | n/a | push to `main` | release tag |

The same container images run on Railway and GCP — Railway is the beta stand-in until production scale
is needed. To stand up the beta environment, follow [**Railway.md**](./Railway.md).

## Databases

| Database | Used by | Connection var |
|---|---|---|
| `pfm_dev` | the running app (`pnpm dev`) | `DATABASE_URL` |
| `pfm_test` | integration tests (`pnpm test`) | `DATABASE_URL_TEST` |

Both run in the same Docker Postgres container (Postgres 16, matching the Neon major version used in
production). Integration tests run against `pfm_test` with per-test transaction rollback, so they never
touch your dev data.

The seeded **site admin** (`hksingh@gmail.com`) is created with a random placeholder password — use the
forgot-password flow to set a real one before logging in as the admin.

## Common tasks

```bash
pnpm dev                                   # run API + web (watch mode)
pnpm test                                  # unit + integration tests (uses pfm_test)
pnpm --filter @pfm/api dev                 # run just the API
pnpm --filter @pfm/db migrate:dev          # create + apply a new migration after editing schema.prisma
pnpm --filter @pfm/db seed                 # re-run the seed (idempotent)
docker compose logs -f postgres            # tail the database logs
docker compose down                        # stop Postgres (keeps data)
docker compose down -v && ./scripts/setup-dev.sh   # wipe the database and start fresh
```

## Migrating an existing local database to encrypted storage

> **Only needed if you pulled this branch while already having Account or Transaction data in your
> local `pfm_dev` database.** Fresh clones and developers who ran `setup-dev.sh` after this change
> can skip this section entirely — `setup-dev.sh` is idempotent and will apply the migration
> automatically.

### Background

As of the encryption migration (`20260625174107_add_encryption_fields`), the following fields are
stored as AES-256-GCM ciphertext instead of plaintext:

| Table | Fields |
|---|---|
| `Account` | `name`, `institution`, `mask`, `balanceMinor` |
| `Transaction` | `merchant`, `merchantNormalized`, `amountMinor` |
| `ImportFile` | `originalName` |

Existing rows that were written as plaintext integers/strings cannot be decrypted — they must be
deleted before the new code starts. **Non-financial tables (User, Household, Category, Budget,
etc.) are untouched.**

### Step 1 — Pull and install

```bash
git pull
pnpm install
```

### Step 2 — Run the migration script

```bash
pnpm migrate:encryption
```

The script will:

1. Add `ENCRYPTION_KEY` to your `.env` if it's missing (uses an all-zeros dev placeholder — fine
   locally, never used in production).
2. Detect whether your database has existing financial rows.
3. If it does, show you exactly what will be deleted and ask for confirmation before proceeding.
4. Truncate `Account`, `Transaction`, `TransactionSplit`, `TransferPair`, `ImportFile`,
   `ImportBatch`, and `TransferRoute`.
5. Apply the pending Prisma migration.

### Step 3 — Restart the dev server

```bash
pnpm dev
```

Log in, create a new account, import a statement, and verify everything works. Any data you enter
from this point is stored encrypted.

### The local `ENCRYPTION_KEY`

Your `.env` will contain:

```
ENCRYPTION_KEY=0000000000000000000000000000000000000000000000000000000000000000
```

This is 32 zero bytes — a valid AES-256 key that the local app uses for all
encrypt/decrypt operations. It is intentionally insecure (do not use it in any deployed
environment). The Railway/production key is a different random value set in Railway's environment
variables; data encrypted locally cannot be decrypted by the production key and vice versa.

---

## Using your own Postgres

If you'd rather not use Docker, point the app at any Postgres 16 instance:

1. Create two databases, e.g. `pfm_dev` and `pfm_test`.
2. Set `DATABASE_URL` and `DATABASE_URL_TEST` in `.env` to those databases.
3. Run setup, skipping the Docker step:

   ```bash
   SKIP_DOCKER=1 ./scripts/setup-dev.sh
   ```

## Troubleshooting

- **Port 5432 already in use** — another Postgres is running. Stop it, or change the host port mapping
  in `docker-compose.yml` and update `DATABASE_URL`/`DATABASE_URL_TEST`.
- **"Postgres did not become ready"** — check `docker compose logs postgres`; on first run the image
  may still be downloading. Re-run the script.
- **Prisma can't find `DATABASE_URL`** — make sure your `.env` exists at the repo root. The script
  loads it into the environment before running Prisma. (Note: the `packages/db/.env` symlink points at
  the repo-root `.env`; on a fresh clone, rely on the root `.env` and the script rather than the
  symlink.)
- **Migrations out of sync after pulling** — run `pnpm --filter @pfm/db exec prisma migrate deploy`
  (and the same with `DATABASE_URL=$DATABASE_URL_TEST`) to apply new migrations, or just re-run
  `./scripts/setup-dev.sh`.
- **Want to log in as the site admin** — trigger the forgot-password flow for `hksingh@gmail.com` to
  set a password (emails are logged to stdout in dev when `RESEND_API_KEY` is unset).
