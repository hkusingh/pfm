/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * Base URL of the PFM API.
   * - Dev: leave unset → the client uses '/api' and the Vite dev proxy forwards to localhost:3000.
   * - Deployed: set to the API's public origin (no trailing slash), inlined at build time.
   */
  readonly VITE_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
