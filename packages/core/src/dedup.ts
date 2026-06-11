import { createHash } from 'crypto';

export function normalizeMerchant(raw: string | null | undefined): string {
  if (!raw) return '';
  return raw
    .toUpperCase()
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/\b(LLC|INC|CORP|LTD|CO)\b\.?/g, '')
    .replace(/[^A-Z0-9 ]/g, '')
    .trim();
}

/**
 * Deterministic dedup key: SHA-256 of account|date|amountMinor|normalizedMerchant.
 * Stored on Transaction.dedupHash. Uniqueness is enforced per-account via @@unique([accountId, dedupHash]).
 */
export function computeDedupHash(
  accountId: string,
  postedDate: string,        // YYYY-MM-DD
  amountMinor: number,
  merchantNormalized: string,
): string {
  const input = `${accountId}|${postedDate}|${amountMinor}|${merchantNormalized}`;
  return createHash('sha256').update(input).digest('hex');
}
