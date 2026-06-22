# ── Stage 1: install + build ──────────────────────────────────────────────────
FROM node:20-slim AS builder

# OpenSSL is required by Prisma's engines (generate + query engine).
RUN apt-get update -y && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
RUN corepack enable && corepack prepare pnpm@9.14.4 --activate

WORKDIR /app

# Copy manifests first so dep-install layer is cached unless lockfile changes
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json ./
COPY packages/config/package.json    ./packages/config/
COPY packages/contracts/package.json ./packages/contracts/
COPY packages/core/package.json      ./packages/core/
COPY packages/db/package.json        ./packages/db/
COPY packages/testing/package.json   ./packages/testing/
COPY packages/ui/package.json        ./packages/ui/
COPY apps/api/package.json           ./apps/api/

# @pfm/db's postinstall runs `prisma generate`, which needs the schema present
# during install — copy it before installing so the lifecycle script succeeds.
COPY packages/db/prisma ./packages/db/prisma

RUN pnpm install --frozen-lockfile

# Copy source (web/ui excluded via .dockerignore — API only needs these)
COPY packages/config    ./packages/config
COPY packages/contracts ./packages/contracts
COPY packages/core      ./packages/core
COPY packages/db        ./packages/db
COPY apps/api           ./apps/api

# turbo respects ^build — builds contracts → core → db → api in order
RUN pnpm turbo build --filter=@pfm/api...

# ── Stage 2: production image ─────────────────────────────────────────────────
FROM node:20-slim AS runner

# OpenSSL is required by Prisma's query engine at runtime.
RUN apt-get update -y && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
RUN corepack enable && corepack prepare pnpm@9.14.4 --activate

WORKDIR /app

# Bring the full built workspace (node_modules + dist artifacts)
COPY --from=builder /app .

ENV NODE_ENV=production

EXPOSE 3000

# Run pending migrations then start the API
CMD ["sh", "-c", \
  "/app/node_modules/.bin/prisma migrate deploy --schema=/app/packages/db/prisma/schema.prisma && exec node /app/apps/api/dist/main.js"]
