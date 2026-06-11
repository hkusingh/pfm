# Contributing — PFM Phase 1

Phase 1 is built by multiple people in parallel. This guide defines how we branch, work independently, and merge cleanly. It pairs with [`docs/phase1-epics-and-stories.md`](./docs/phase1-epics-and-stories.md).

## Getting set up

New to the repo? Run `./scripts/setup-dev.sh` then `pnpm dev`. See [`docs/development-setup.md`](./docs/development-setup.md) for prerequisites, the `AUTH_GATE` dev flag, the dev/test databases, and troubleshooting.

## Branch strategy

- `main` — protected; always green; releasable.
- **Epic branches** (long-lived, one per epic / team): `epic/0-foundation`, `epic/1-household`, `epic/2-accounts`, `epic/3-import`, `epic/4-categories`, `epic/5-transactions`, `epic/6-budgets`, `epic/7-dashboard`.
- **Story branches** (short-lived): `story/E2.3-plaid-sync` → PR into the epic branch.

## Parallel-work waves

| Wave | Epics (parallel) |
|---|---|
| 1 | Epic 0 — Foundation (land first; everyone depends on it) |
| 2 | Epic 1, Epic 2, Epic 4 |
| 3 | Epic 3, Epic 5, Epic 6 |
| 4 | Epic 7 |

## Working agreements

1. **Contracts first.** The data model, API request/response shapes, and the visibility-scope helper (Epic 0) are stable interfaces. Changing a shared contract requires a cross-team PR review.
2. **Stub dependencies.** Mock upstream modules so no team is blocked; integrate against the real module at the wave boundary.
3. **Vertical slices.** Each story includes backend + API + UI where applicable; hide incomplete work behind a feature flag.
4. **Visibility is mandatory.** Every endpoint returning account/transaction data must go through the Epic 0 visibility helper and include a leakage test.

## Pull requests

- Small, focused PRs; link the story ID (e.g. `E4.5`) and PRD reference.
- CI must pass (lint + tests); at least one review.
- Squash-merge story branches into epic branches; merge epic branches into `main` at wave boundaries.

## Definition of Done

Code + tests written, acceptance criteria met, visibility rules respected, PR reviewed, CI green, merged.
