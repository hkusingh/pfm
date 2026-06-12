// Object-store abstraction — implemented as LocalObjectStore in the API for Phase 1 local-first.
// In production, swap for a GCS-backed implementation without touching any business logic.
export interface ObjectStore {
  put(key: string, data: Buffer): Promise<void>;
  get(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
}
