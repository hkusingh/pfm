// AUTH_GATE=true  → full enforcement (email verify, MFA, invite-only signup)
// AUTH_GATE=false → all auth friction disabled for local testing
export const authGate = () => process.env.AUTH_GATE === 'true';
