// Test infrastructure: factories, leakage-matrix harness, and determinism stubs.
// Populated alongside the stories that need them:
//   E0.5  leakage matrix (two members, all visibility states)
//   E0.3  auth factories (user, session)
//         clock stub (injectable, freeze for period/amortization tests)
//         SMTP stub (no real network in tests)
//         object-store stub (no real GCS in tests)
export {};
