// Single source for the user-facing product name on the web client.
// Override per environment with the build-time var VITE_PUBLIC_APP_NAME
// (Vite inlines it at build); falls back to the current brand otherwise.
export const APP_NAME = import.meta.env.VITE_PUBLIC_APP_NAME ?? 'Smart Munshi';

// Brand artwork in apps/web/public. The full lockup (transparent bg) includes the
// wordmark + tagline; the square mark is just the shield emblem (favicon/compact use).
export const APP_LOGO = '/thesm-logo-dark-t.png';
export const APP_MARK = '/thesm-mark.png';
