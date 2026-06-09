// Framework-agnostic domain logic — reused by api, worker (Phase 2), and future agent.
//
// Populated story by story:
//   E0.5  resolveScope (visibility scope helper) — HIGHEST RISK, 90% coverage floor
//   E2.4  buildDedupHash
//   E6.3  amortize, computeReserveBalance (sinking funds)
//         money utilities (addMinor, formatMinor, etc.)
//         period / date helpers
export * from './visibility';
