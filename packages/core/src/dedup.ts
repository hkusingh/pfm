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
 * Merchant key for category rule matching — normalizes and strips trailing bank
 * reference tokens (date codes, sequence numbers, store IDs) that vary per transaction
 * but belong to the same merchant.
 *
 * Examples:
 *   "WF HOME MTG 06/09"      → "WF HOME MTG"
 *   "AMAZON MARKETPLACE 123" → "AMAZON MARKETPLACE"
 *   "STARBUCKS #1234"        → "STARBUCKS"
 */
export function merchantRuleKey(raw: string | null | undefined): string {
  const norm = normalizeMerchant(raw);
  if (!norm) return '';
  const words = norm.split(' ');
  let end = words.length;
  // Strip trailing tokens that are purely numeric (dates like "0609", reference IDs)
  while (end > 1 && /^\d+$/.test(words[end - 1])) {
    end--;
  }
  return words.slice(0, end).join(' ');
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
