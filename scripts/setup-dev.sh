#!/usr/bin/env bash
#
# PFM — local development environment setup.
#
# Brings a fresh checkout to a runnable state:
#   • checks prerequisites
#   • creates .env from .env.example (with generated dev secrets, AUTH_GATE=false)
#   • starts a local Postgres (Docker Compose) and waits for it
#   • installs workspace dependencies
#   • generates the Prisma client and applies migrations to the dev + test databases
#   • seeds the registration policy and the first site admin
#
# Idempotent: safe to re-run. See docs/development-setup.md for the manual steps
# and troubleshooting.
#
# Usage:
#   ./scripts/setup-dev.sh
#   SKIP_DOCKER=1 ./scripts/setup-dev.sh   # use your own Postgres (set DATABASE_URL[_TEST] first)
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

say()  { printf '\n\033[1;34m▸ %s\033[0m\n' "$1"; }
ok()   { printf '\033[1;32m  ✓ %s\033[0m\n' "$1"; }
warn() { printf '\033[1;33m  ! %s\033[0m\n' "$1"; }
die()  { printf '\n\033[1;31m✗ %s\033[0m\n' "$1" >&2; exit 1; }

# ── 1. Prerequisites ──────────────────────────────────────────────────────────
say "Checking prerequisites"

command -v node >/dev/null 2>&1 || die "Node.js >= 20 is required — https://nodejs.org"
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
[ "$NODE_MAJOR" -ge 20 ] || die "Node.js >= 20 required (found $(node -v))."
ok "node $(node -v)"

if ! command -v pnpm >/dev/null 2>&1; then
  die "pnpm is required. Install with:  corepack enable  (or:  npm install -g pnpm)"
fi
ok "pnpm $(pnpm -v)"

command -v openssl >/dev/null 2>&1 || die "openssl is required to generate local dev secrets."

if [ "${SKIP_DOCKER:-0}" != "1" ]; then
  command -v docker >/dev/null 2>&1 || die \
    "Docker is required for the local Postgres. Install Docker, or run with SKIP_DOCKER=1 and point DATABASE_URL / DATABASE_URL_TEST at your own Postgres."
  docker compose version >/dev/null 2>&1 || die "The 'docker compose' plugin is required (Docker Desktop / Compose v2)."
  ok "docker $(docker --version | awk '{print $3}' | tr -d ',')"
fi

# ── 2. .env ───────────────────────────────────────────────────────────────────
say "Configuring .env"
if [ -f .env ]; then
  warn ".env already exists — leaving it untouched."
else
  cp .env.example .env
  # portable in-place sed (works on both BSD/macOS and GNU/Linux)
  sed_i() { sed -i.bak "$1" .env && rm -f .env.bak; }
  for key in JWT_ACCESS_SECRET JWT_REFRESH_SECRET ENCRYPTION_KEY; do
    sed_i "s|^${key}=.*|${key}=$(openssl rand -hex 32)|"
  done
  # Local dev: disable auth friction (invite / email-verify / MFA).
  # NEVER set false in a deployed or CI environment.
  sed_i "s|^AUTH_GATE=.*|AUTH_GATE=false|"
  ok "Created .env with generated dev secrets and AUTH_GATE=false."
fi

# Load DB connection vars into this shell so Prisma sees them regardless of
# how Prisma's own dotenv resolution behaves inside the workspace.
set -a
# shellcheck disable=SC1091
. ./.env
set +a
: "${DATABASE_URL:?DATABASE_URL is not set in .env}"
: "${DATABASE_URL_TEST:?DATABASE_URL_TEST is not set in .env}"

# ── 3. Postgres ───────────────────────────────────────────────────────────────
if [ "${SKIP_DOCKER:-0}" = "1" ]; then
  say "Postgres (SKIP_DOCKER=1)"
  warn "Assuming Postgres is running and the 'pfm_dev' + 'pfm_test' databases exist."
else
  say "Starting Postgres (docker compose)"
  docker compose up -d postgres
  printf '  waiting for Postgres'
  for i in $(seq 1 60); do
    if docker compose exec -T postgres pg_isready -U pfm -d pfm_dev >/dev/null 2>&1; then
      printf ' ready.\n'; break
    fi
    printf '.'; sleep 1
    [ "$i" -eq 60 ] && { printf '\n'; die "Postgres did not become ready in 60s. Check: docker compose logs postgres"; }
  done
  ok "Postgres up (pfm_dev + pfm_test)."
fi

# ── 4. Dependencies ───────────────────────────────────────────────────────────
say "Installing dependencies (pnpm install)"
pnpm install
ok "Dependencies installed."

# ── 5. Prisma client + migrations ─────────────────────────────────────────────
say "Generating Prisma client + applying migrations"
pnpm --filter @pfm/db generate
# Apply committed migrations non-interactively to both databases.
pnpm --filter @pfm/db exec prisma migrate deploy
DATABASE_URL="$DATABASE_URL_TEST" pnpm --filter @pfm/db exec prisma migrate deploy
ok "Migrations applied to pfm_dev and pfm_test."

# ── 6. Seed ───────────────────────────────────────────────────────────────────
say "Seeding (registration policy + site admin)"
pnpm --filter @pfm/db seed
ok "Seeded."

# ── Done ──────────────────────────────────────────────────────────────────────
cat <<EOF

$(printf '\033[1;32m✓ Local environment ready.\033[0m')

Start the app (API + web, watch mode):
    pnpm dev
      API → http://localhost:3000
      Web → http://localhost:5173

Notes:
  • AUTH_GATE=false in your .env → signup needs no invite, email auto-verifies,
    and MFA is not required. Flip it to true to exercise the full invite/MFA flow.
  • Site admin seeded as hksingh@gmail.com — use the forgot-password flow to set a
    password (it is created with a random placeholder).
  • Run tests:        pnpm test        (integration uses the pfm_test database)
  • Reset everything: docker compose down -v && ./scripts/setup-dev.sh
EOF
