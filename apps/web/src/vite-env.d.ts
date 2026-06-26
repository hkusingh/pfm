/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * Base URL of the API.
   * - Dev: leave unset → the client uses '/api' and the Vite dev proxy forwards to localhost:3000.
   * - Deployed: set to the API's public origin (no trailing slash), inlined at build time.
   */
  readonly VITE_API_URL?: string;
  /**
   * User-facing product name (the brand). Inlined at build time; defaults to "Smart Munshi".
   */
  readonly VITE_PUBLIC_APP_NAME?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
