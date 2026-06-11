// Global setup: swap DATABASE_URL → test database before Prisma client is created.
import { config } from 'dotenv';
import { resolve } from 'path';

export function setup() {
  // Load .env from repo root (four levels up from apps/api/src/test/)
  config({ path: resolve(__dirname, '../../../../.env') });

  const testUrl = process.env.DATABASE_URL_TEST;
  if (!testUrl) {
    throw new Error('DATABASE_URL_TEST is not set. Add it to your .env file.');
  }
  process.env.DATABASE_URL = testUrl;

  // Suppress real email sends in tests — EmailService logs instead of sending when key is absent
  delete process.env.RESEND_API_KEY;
}
