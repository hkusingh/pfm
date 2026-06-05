# Personal Finance Manager (PFM)

A household-first personal finance web application that gives families a single, trustworthy, 360° view of their money — income, expenses, accounts, and (later) net worth — with budgeting, AI-driven insights, and natural-language access.

> **Status:** Planning complete; Phase 1 ready for development.

---

## What this repo is

This repository holds the **product and technical planning artifacts** for PFM and will house the **codebase** as development proceeds. The planning docs in [`/docs`](./docs) are the source of truth that drive implementation (including via the Claude VS Code plugin).

## Documentation index (`/docs`)

Recommended reading order:

| # | Document | What it covers |
|---|----------|----------------|
| 1 | [discovery-brief.docx](./docs/discovery-brief.docx) | Problem space, audience, competitive landscape, approach, key decisions |
| 2 | [feature-breakdown.docx](./docs/feature-breakdown.docx) | All features by capability area, prioritized (P0–P2) and phased |
| 3 | [personas-and-flows.html](./docs/personas-and-flows.html) | Personas, use cases, and flow diagrams |
| 4 | [wireframes-phase1.html](./docs/wireframes-phase1.html) | Mid-fi wireframes for Phase 1 screens (open in a browser) |
| 5 | [ai-features-and-architecture.html](./docs/ai-features-and-architecture.html) | AI feature set + AI/agent architecture, model strategy, channels |
| 6 | [roadmap.html](./docs/roadmap.html) | Phased roadmap (Phase 1–3) with AI woven in |
| 7 | [phase1-spec.md](./docs/phase1-spec.md) | Phase 1 PRD — requirements, acceptance criteria, edge cases |
| 8 | [phase1-technical-design.html](./docs/phase1-technical-design.html) | Architecture, data model (ER), API surface, Plaid integration, visibility enforcement |
| 9 | [phase1-epics-and-stories.md](./docs/phase1-epics-and-stories.md) | Sprint-ready epics & stories, structured for parallel development |

## Key product decisions

- **Audience:** households/families first (multi-member, shared + private finances).
- **Wedge:** budgeting & spending on top of account aggregation.
- **Differentiator:** AI insights (Phase 2+), with a conversational agent (Phase 3).
- **Connectivity:** Phase 1 uses **document/statement upload + manual entry** (limited-user test); **Plaid** live aggregation arrives in Phase 2 (no stored bank credentials).
- **Security:** mandatory MFA (Google Authenticator + email); per-account visibility (shared / private / balance-only).
- **Platform:** web-first (responsive); native mobile later.

## Phase 1 scope (MVP)

Limited-user test release. Household & membership, mandatory MFA, **document/statement upload + manual entry** (no live aggregation), per-account visibility, categories & sub-categories, budgets with amortized sinking funds, and a spending dashboard with default charts. Plaid aggregation is Phase 2. See [phase1-spec.md](./docs/phase1-spec.md).

## Development

Phase 1 is broken into **parallel-workable epics** — see [phase1-epics-and-stories.md](./docs/phase1-epics-and-stories.md) and [CONTRIBUTING.md](./CONTRIBUTING.md) for the branch/merge strategy. Source code will live under `/src` (or per-service folders) as it is built.

---

*Planning artifacts generated with Claude. Engage qualified legal/security specialists before handling real financial data.*
