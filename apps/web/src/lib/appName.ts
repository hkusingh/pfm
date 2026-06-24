// Single source for the user-facing product name on the web client.
// Override per environment with the build-time var VITE_PUBLIC_APP_NAME
// (Vite inlines it at build); falls back to the current brand otherwise.
export const APP_NAME = import.meta.env.VITE_PUBLIC_APP_NAME ?? 'Smart Munshi';
