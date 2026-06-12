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
 * Similarity score between two merchant rule keys — 0 (no match) to 1 (exact).
 * Combines three signals and returns the maximum:
 *
 *   1. Word Jaccard       — shared words / all words
 *   2. Containment        — what fraction of the shorter string's words appear in the longer
 *   3. Char-prefix ratio  — longest common character prefix (spaces ignored) / max char length
 *                           catches "WAL MART" ↔ "WALMART" and partial abbreviations
 *
 * Both inputs should already be processed by `merchantRuleKey`.
 */
export function merchantSimilarityScore(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;

  const aWords = a.split(' ').filter(Boolean);
  const bWords = b.split(' ').filter(Boolean);
  const aSet = new Set(aWords);
  const bSet = new Set(bWords);

  // Signal 1: Word Jaccard
  const intersectionCount = aWords.filter((w) => bSet.has(w)).length;
  const unionCount = new Set([...aWords, ...bWords]).size;
  const jaccard = intersectionCount / unionCount;

  // Signal 2: Containment — fraction of the shorter string's words found in the longer
  const shorter = aWords.length <= bWords.length ? aWords : bWords;
  const longerSet = aWords.length <= bWords.length ? bSet : aSet;
  const containment = shorter.filter((w) => longerSet.has(w)).length / shorter.length;

  // Signal 3: Character prefix ratio (spaces stripped)
  const aChars = a.replace(/ /g, '');
  const bChars = b.replace(/ /g, '');
  let prefixLen = 0;
  while (prefixLen < aChars.length && prefixLen < bChars.length && aChars[prefixLen] === bChars[prefixLen]) {
    prefixLen++;
  }
  const charPrefix = prefixLen / Math.max(aChars.length, bChars.length);

  return Math.max(jaccard, containment, charPrefix);
}

/** Minimum score from `merchantSimilarityScore` to consider two merchants the same. */
export const MERCHANT_MATCH_THRESHOLD = 0.65;

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
