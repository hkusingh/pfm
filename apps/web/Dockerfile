# Web (Vite SPA) image — builds the static bundle and serves it.
#
# Build from the REPO ROOT (monorepo context), pointing at this Dockerfile:
#   docker build -f apps/web/Dockerfile --build-arg VITE_API_URL=https://api.example .
#
# VITE_API_URL must be passed at BUILD time — Vite inlines env vars into the
# bundle. On Railway, set it as a service variable on the web service (Railway
# exposes variables to the Docker build); a redeploy is needed if it changes.

# ── Stage 1: build ────────────────────────────────────────────────────────────
FROM node:20-slim AS builder
# OpenSSL is needed because @pfm/db's postinstall runs `prisma generate`.
RUN apt-get update -y && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
RUN corepack enable && corepack prepare pnpm@9.14.4 --activate
WORKDIR /app

# Manifests first so the dependency layer is cached unless the lockfile changes.
# All workspace package manifests are needed for a frozen-lockfile install.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json ./
COPY packages/config/package.json    ./packages/config/
COPY packages/contracts/package.json ./packages/contracts/
COPY packages/core/package.json      ./packages/core/
COPY packages/db/package.json        ./packages/db/
COPY packages/testing/package.json   ./packages/testing/
COPY packages/ui/package.json        ./packages/ui/
COPY apps/web/package.json           ./apps/web/

# @pfm/db's postinstall runs `prisma generate` during install (it's in the
# workspace), which needs the schema present — copy it before installing.
COPY packages/db/prisma ./packages/db/prisma

RUN pnpm install --frozen-lockfile

# Sources the web build actually needs (web → contracts, ui, config).
COPY packages/config    ./packages/config
COPY packages/contracts ./packages/contracts
COPY packages/ui        ./packages/ui
COPY apps/web           ./apps/web

# API base URL is baked into the bundle here.
ARG VITE_API_URL
ENV VITE_API_URL=$VITE_API_URL

# turbo ^build compiles contracts/ui/config before @pfm/web
RUN pnpm turbo build --filter=@pfm/web...

# ── Stage 2: static server ────────────────────────────────────────────────────
FROM node:20-slim AS runner
RUN npm install -g serve@14
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/apps/web/dist ./dist

# `serve -s` serves the SPA with history fallback to index.html.
# Honor the platform-provided $PORT (Railway/Cloud Run); default 8080 locally.
CMD ["sh", "-c", "serve -s dist -l ${PORT:-8080}"]
