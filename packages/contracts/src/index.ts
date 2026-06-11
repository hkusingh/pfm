// Zod schemas + inferred TypeScript types for every API request/response.
// Organised by domain: auth (E0.3), mfa (E0.4), household (E1), accounts (E2), ...
// Contracts are defined here first; server and all clients import the inferred types.
export * from './auth';
export * from './mfa';
export * from './household';
