# GCP Hosting — Migration Runbook & CI/CD

How PFM goes from local-first development to running on Google Cloud, and the CI/CD pipeline that keeps
it deployed. Pairs with the architecture/hosting decisions in
[`../IMPLEMENTATION_PLAN.md`](../IMPLEMENTATION_PLAN.md) §5 and the guardrails in
[`../CLAUDE.md`](../CLAUDE.md).

> **Status:** standing up **staging now**, even before all Phase-1 features land, so the deploy path is
> proven while the surface is small. **Production** follows at the invite-only limited-test launch.

---

## 0. Target architecture (recap)

| Concern | Service |
|---|---|
| API (`apps/api`, NestJS container) | **Cloud Run** (scales to zero; HTTPS) |
| Web (`apps/web`, Vite static SPA) | **Firebase Hosting** (CDN + custom domain; simplest static host on GCP) |
| Database | **Neon Postgres** (managed; pooled URL for the app, direct URL for migrations) |
| Uploaded statements | **Cloud Storage (GCS)**, encrypted, behind the `@pfm/core` object-store interface |
| BYOK AI keys | **Cloud KMS** envelope encryption |
| Secrets | **Secret Manager** (mounted into Cloud Run) |
| CI/CD | **GitHub Actions** → Artifact Registry → Cloud Run / Firebase, keyless via **Workload Identity Federation** |

**Environments:** two **separate GCP projects** — `pfm-staging` and `pfm-prod` — for clean IAM and
billing isolation. Same container image is promoted from staging to prod (build once, deploy many).

---

## 1. Phase A — GCP foundation (one-time, per project)

Do this for `pfm-staging` first; repeat for `pfm-prod` later. Click-ops is fine to start; capture it in
Terraform once stable. Set your shell:

```bash
export PROJECT=pfm-staging
export REGION=us-central1
gcloud config set project "$PROJECT"
```

### 1.1 Enable APIs

```bash
gcloud services enable \
  run.googleapis.com artifactregistry.googleapis.com \
  secretmanager.googleapis.com storage.googleapis.com \
  cloudkms.googleapis.com iamcredentials.googleapis.com \
  sts.googleapis.com
```

### 1.2 Artifact Registry (Docker images)

```bash
gcloud artifacts repositories create pfm \
  --repository-format=docker --location="$REGION" \
  --description="PFM container images"
```

### 1.3 Storage, KMS, Secrets

```bash
# Encrypted bucket for uploaded statements (uniform access, private)
gcloud storage buckets create "gs://${PROJECT}-statements" \
  --location="$REGION" --uniform-bucket-level-access --public-access-prevention

# KMS keyring + key for BYOK AI envelope encryption
gcloud kms keyrings create pfm --location="$REGION"
gcloud kms keys create byok --location="$REGION" --keyring=pfm --purpose=encryption

# Secrets (create empty, then add versions). Repeat per secret.
for s in jwt-access-secret jwt-refresh-secret encryption-key \
         database-url direct-database-url resend-api-key; do
  gcloud secrets create "$s" --replication-policy=automatic
done
# Add a value:
printf '%s' "$(openssl rand -hex 32)" | gcloud secrets versions add jwt-access-secret --data-file=-
```

### 1.4 Neon

- Create a Neon project per environment (or a branch per environment).
- Grab **two** connection strings: the **pooled** one (host contains `-pooler`) and the **direct**
  (unpooled) one.
- Store pooled → `database-url` secret; direct → `direct-database-url` secret.
- **Add `directUrl` to the Prisma schema** (see §5) so migrations use the direct connection — pooled
  PgBouncer connections can't run migrations.

### 1.5 Service accounts (least privilege)

```bash
# Runtime SA — what the Cloud Run service runs as
gcloud iam service-accounts create pfm-api-run --display-name="PFM API runtime"
RUN_SA="pfm-api-run@${PROJECT}.iam.gserviceaccount.com"

# Grant only what the API needs
gcloud projects add-iam-policy-binding "$PROJECT" \
  --member="serviceAccount:$RUN_SA" --role="roles/secretmanager.secretAccessor"
gcloud storage buckets add-iam-policy-binding "gs://${PROJECT}-statements" \
  --member="serviceAccount:$RUN_SA" --role="roles/storage.objectAdmin"
gcloud kms keys add-iam-policy-binding byok --location="$REGION" --keyring=pfm \
  --member="serviceAccount:$RUN_SA" --role="roles/cloudkms.cryptoKeyEncrypterDecrypter"

# Deploy SA — what CI assumes via WIF
gcloud iam service-accounts create pfm-deployer --display-name="PFM CI deployer"
DEPLOY_SA="pfm-deployer@${PROJECT}.iam.gserviceaccount.com"
for role in roles/run.admin roles/artifactregistry.writer roles/iam.serviceAccountUser; do
  gcloud projects add-iam-policy-binding "$PROJECT" --member="serviceAccount:$DEPLOY_SA" --role="$role"
done
```

### 1.6 Workload Identity Federation (keyless GitHub → GCP)

No service-account JSON keys in GitHub. GitHub's OIDC token is exchanged for short-lived GCP creds.

```bash
gcloud iam workload-identity-pools create github --location=global --display-name="GitHub"

gcloud iam workload-identity-pools providers create-oidc github \
  --location=global --workload-identity-pool=github \
  --display-name="GitHub OIDC" \
  --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository" \
  --attribute-condition="assertion.repository=='hkusingh/pfm'" \
  --issuer-uri="https://token.actions.githubusercontent.com"

# Let the repo impersonate the deploy SA
PROJECT_NUMBER="$(gcloud projects describe "$PROJECT" --format='value(projectNumber)')"
gcloud iam service-accounts add-iam-policy-binding "$DEPLOY_SA" \
  --role=roles/iam.workloadIdentityUser \
  --member="principalSet://iam.googleapis.com/projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/github/attribute.repository/hkusingh/pfm"
```

Note the **provider resource name** and the **deploy SA email** — CI needs them (store as GitHub repo
variables, not secrets; they're not sensitive).

---

## 2. Phase B — Containerize & one manual smoke deploy

The goal is to flush IAM/secret/DB wiring **once, by hand**, before automating.

### 2.1 API Dockerfile (`Dockerfile`)

Multi-stage, slim, non-root, honors `$PORT`:

```dockerfile
# ---- build ----
FROM node:20-slim AS build
WORKDIR /app
RUN corepack enable
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @pfm/db generate
RUN pnpm --filter @pfm/api build
RUN pnpm --filter @pfm/api deploy --prod /out   # pruned production bundle

# ---- runtime ----
FROM node:20-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /out ./
USER node
# Cloud Run sets $PORT; the app must listen on it and on 0.0.0.0
CMD ["node", "dist/main.js"]
```

Make sure the Nest app does `app.listen(process.env.PORT ?? 3000, '0.0.0.0')` and exposes `GET /health`.

### 2.2 Build, push, deploy (manual, once)

```bash
gcloud auth configure-docker "${REGION}-docker.pkg.dev"
IMAGE="${REGION}-docker.pkg.dev/${PROJECT}/pfm/api:smoke"
docker build -f Dockerfile -t "$IMAGE" .
docker push "$IMAGE"

# Run migrations against Neon (direct URL) BEFORE serving
DIRECT_URL="$(gcloud secrets versions access latest --secret=direct-database-url)"
DATABASE_URL="$DIRECT_URL" pnpm --filter @pfm/db exec prisma migrate deploy

gcloud run deploy pfm-api \
  --image="$IMAGE" --region="$REGION" --service-account="$RUN_SA" \
  --allow-unauthenticated \
  --set-env-vars="NODE_ENV=production,AUTH_GATE=true,WEB_ORIGIN=https://app-staging.pfm.example" \
  --set-secrets="DATABASE_URL=database-url:latest,DIRECT_DATABASE_URL=direct-database-url:latest,JWT_ACCESS_SECRET=jwt-access-secret:latest,JWT_REFRESH_SECRET=jwt-refresh-secret:latest,ENCRYPTION_KEY=encryption-key:latest,RESEND_API_KEY=resend-api-key:latest" \
  --min-instances=0 --max-instances=4 --cpu=1 --memory=512Mi
```

Hit the printed URL's `/health`. If green, the wiring works — tear the smoke revision down or leave it
idling at zero (it costs ~nothing).

### 2.3 Web (Firebase Hosting)

```bash
pnpm --filter @pfm/web build           # produces dist/
firebase deploy --only hosting --project "$PROJECT"
```

Set the web build's API base URL (e.g. `VITE_API_URL`) to the Cloud Run service URL / `api.` subdomain.

---

## 3. Phase C — CI/CD (GitHub Actions)

Three triggers: PR checks, staging deploy on merge to `main`, prod promotion on a release tag.

### 3.1 Pipeline overview

| Trigger | Does |
|---|---|
| **Pull request** | lint · typecheck · unit + integration tests (Postgres service container) · build image (no push). Merge blocked on red. |
| **Push to `main`** | build + push image tagged with the git SHA → `migrate deploy` (direct URL) on **staging** Neon → deploy Cloud Run (staging) → deploy web to Firebase (staging) → smoke/e2e. |
| **Release tag `v*`** (manual approval) | **promote the same SHA image** to **prod**: migrate prod Neon → deploy Cloud Run (prod) → deploy web (prod). No rebuild. |

Use **GitHub Environments** (`staging`, `production`) and require a reviewer on `production` for the
approval gate. Store the WIF provider name + deploy SA email as **environment variables** per environment.

### 3.2 Sample deploy job (staging, keyless via WIF)

`.github/workflows/deploy-staging.yml` (sketch — adjust names):

```yaml
name: deploy-staging
on:
  push: { branches: [main] }
permissions:
  contents: read
  id-token: write          # required for WIF OIDC
jobs:
  deploy:
    runs-on: ubuntu-latest
    environment: staging
    env:
      PROJECT: pfm-staging
      REGION: us-central1
    steps:
      - uses: actions/checkout@v4
      - id: auth
        uses: google-github-actions/auth@v3
        with:
          workload_identity_provider: ${{ vars.WIF_PROVIDER }}   # projects/.../providers/github
          service_account: ${{ vars.DEPLOY_SA }}                 # pfm-deployer@pfm-staging...
      - uses: google-github-actions/setup-gcloud@v3
      - name: Build & push image
        run: |
          gcloud auth configure-docker "$REGION-docker.pkg.dev" -q
          IMAGE="$REGION-docker.pkg.dev/$PROJECT/pfm/api:${{ github.sha }}"
          docker build -f Dockerfile -t "$IMAGE" .
          docker push "$IMAGE"
          echo "IMAGE=$IMAGE" >> "$GITHUB_ENV"
      - name: Migrate (direct URL)
        run: |
          DIRECT_URL="$(gcloud secrets versions access latest --secret=direct-database-url)"
          corepack enable && pnpm install --frozen-lockfile
          DATABASE_URL="$DIRECT_URL" pnpm --filter @pfm/db exec prisma migrate deploy
      - name: Deploy Cloud Run
        uses: google-github-actions/deploy-cloudrun@v3
        with:
          service: pfm-api
          region: us-central1
          image: ${{ env.IMAGE }}
          flags: >-
            --service-account=pfm-api-run@pfm-staging.iam.gserviceaccount.com
            --set-env-vars=NODE_ENV=production,AUTH_GATE=true
            --set-secrets=DATABASE_URL=database-url:latest,DIRECT_DATABASE_URL=direct-database-url:latest,JWT_ACCESS_SECRET=jwt-access-secret:latest,JWT_REFRESH_SECRET=jwt-refresh-secret:latest,ENCRYPTION_KEY=encryption-key:latest
            --min-instances=0 --max-instances=4
      - name: Deploy web
        run: pnpm --filter @pfm/web build && npx firebase-tools deploy --only hosting --project "$PROJECT"
```

The prod workflow is the same, triggered `on: release` (or tag), targeting `pfm-prod`, **reusing the
image** already built for that SHA (`docker pull` staging image, `docker tag`/push to prod registry, or
keep a single shared registry the prod SA can read).

### 3.3 Rules baked into the pipeline

- **Build once, deploy many.** Prod uses the exact image validated in staging — never a fresh build.
- **`AUTH_GATE=true` is set explicitly on every deploy.** The deploy step sets it; it never inherits an
  env file. A deployed env can't ship with auth disabled. (See CLAUDE.md guardrail 9.)
- **Migrations run before traffic shifts**, using the direct (unpooled) Neon URL.
- **Expand/contract migrations.** Make schema changes backward-compatible (add columns/tables before
  using them; remove only after the old revision is gone). Because Cloud Run keeps the previous revision
  and rollback is instant, the old code must still work against the new schema.

---

## 4. Phase D — Production & custom domain

1. Repeat Phase A in `pfm-prod` (separate Neon, secrets, SAs, WIF binding).
2. Wire the prod deploy workflow (release-triggered, reviewer-gated).
3. **Domain:** map subdomains via Cloud Run **domain mapping** — `api.pfm.<domain>` → the Cloud Run
   service (verify the domain once, add the `CNAME` Google provides; managed TLS is automatic), and
   `app.pfm.<domain>` → Firebase Hosting. Graduate to a Global External Load Balancer later if you need
   apex-domain support, Cloud CDN in front of the API, or Cloud Armor (WAF).
4. **Seed prod carefully:** run the site-admin seed once against prod, then immediately set a real
   password via the forgot-password flow (the seed uses a random placeholder).

---

## 5. Required code change before first deploy

Add `directUrl` to the Prisma datasource so migrations use the unpooled connection (you're on Prisma 5):

```prisma
datasource db {
  provider  = "postgresql"
  url       = env("DATABASE_URL")          // Neon POOLED (-pooler host) — app traffic
  directUrl = env("DIRECT_DATABASE_URL")   // Neon DIRECT (unpooled) — migrations / introspection
}
```

Locally, set `DIRECT_DATABASE_URL` to the same value as `DATABASE_URL` (no pooler in dev) so nothing
changes for local development. Also confirm the API listens on `process.env.PORT` and `0.0.0.0`, and
exposes `GET /health`.

---

## 6. Operations

- **Rollback (app):** `gcloud run services update-traffic pfm-api --to-revisions=PREV=100` — instant.
  DB rollback is avoided by the expand/contract discipline (forward-fix preferred).
- **Logs/metrics:** Cloud Logging + Cloud Monitoring are automatic; add an uptime check on `/health`
  and a billing budget alert per project.
- **Cost:** staging Cloud Run + Neon scale to zero → ~zero when idle. For prod, consider
  `--min-instances=1` to avoid cold starts once real users arrive. Avoid always-on pieces (load
  balancer, NAT) until you actually need them.
- **Connection limits:** each Cloud Run instance opens its own Prisma pool; keep the pooled
  `DATABASE_URL` (Neon pooler) and set a modest `connection_limit` so autoscaling doesn't exhaust Neon.

---

## 7. Checklist (staging bring-up)

- [ ] `pfm-staging` project; APIs enabled
- [ ] Artifact Registry repo `pfm`
- [ ] GCS statements bucket; KMS key `byok`
- [ ] Secrets created + populated (JWT×2, encryption key, pooled + direct DB URLs, Resend)
- [ ] Neon project; pooled + direct URLs captured
- [ ] `directUrl` added to `schema.prisma`; `DIRECT_DATABASE_URL` in local `.env`
- [ ] Runtime SA + deploy SA with least-privilege roles
- [ ] WIF pool/provider bound to `hkusingh/pfm`
- [ ] `Dockerfile`; app listens on `$PORT`/`0.0.0.0`; `/health` exists
- [ ] Manual smoke deploy green
- [ ] GitHub Actions: PR checks + `deploy-staging` workflow; GitHub Environments configured
- [ ] Web on Firebase Hosting; `VITE_API_URL` points at the API

Sources: [google-github-actions/auth](https://github.com/google-github-actions/auth) ·
[deploy-cloudrun](https://github.com/google-github-actions/deploy-cloudrun) ·
[Enabling keyless auth from GitHub Actions (Google Cloud)](https://cloud.google.com/blog/products/identity-security/enabling-keyless-authentication-from-github-actions) ·
[Connect Prisma to Neon](https://neon.com/docs/guides/prisma) ·
[Prisma + Neon migrations](https://neon.com/docs/guides/prisma-migrations)
