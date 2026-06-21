import { z } from 'zod';

// ── Preview (step 1) ─────────────────────────────────────────────────────────

export const CsvColumnMappingSchema = z.object({
  dateCol: z.string(),
  merchantCol: z.string(),
  // Single-column mode: one column contains signed amounts
  amountCol: z.string().optional(),
  // Split-column mode: separate debit (outflow) and credit (inflow) columns
  debitCol: z.string().optional(),
  creditCol: z.string().optional(),
  invertAmount: z.boolean().optional(),
});

export const ImportPreviewResponseSchema = z.object({
  batchId: z.string(),
  format: z.enum(['csv', 'ofx', 'qfx', 'pdf']),
  // CSV only — null for OFX/QFX (auto-mapped)
  columns: z.array(z.string()).nullable(),
  sampleRows: z.array(z.record(z.string())).nullable(),
  rowCount: z.number().int(),
  fingerprint: z.string(),
  suggestedMapping: CsvColumnMappingSchema.nullable(),
  // OFX/QFX: rows are ready for commit without a mapping step
  autoMapped: z.boolean(),
});

// ── Commit (step 2) ──────────────────────────────────────────────────────────

export const ImportCommitBodySchema = z.object({
  batchId: z.string(),
  accountId: z.string(),
  // Required for CSV; omit for OFX/QFX
  mapping: CsvColumnMappingSchema.optional(),
});

// A row flagged as a possible fuzzy duplicate during commit — needs user review.
export const FlaggedDuplicateSchema = z.object({
  // Incoming row (the one being imported)
  date: z.string(),
  merchant: z.string().nullable(),
  amountMinor: z.number().int(),
  // Existing transaction it was matched against
  existingId: z.string(),
  existingMerchant: z.string().nullable(),
  existingCategoryName: z.string().nullable(),
  existingCategoryColor: z.string().nullable(),
  existingPostedDate: z.string(),  // may differ slightly from incoming date
});

// Transfer-kind transactions with no known routing rule — user must assign a counterpart.
export const NeedsRoutingItemSchema = z.object({
  txId: z.string(),
  postedDate: z.string(),
  merchant: z.string().nullable(),
  amountMinor: z.number().int(),
  // Amount-based candidate counterpart found in another account (suggestion only).
  suggestedCounterpartAccountId: z.string().nullable(),
  suggestedCounterpartAccountName: z.string().nullable(),
});
export type NeedsRoutingItem = z.infer<typeof NeedsRoutingItemSchema>;

export const ImportCommitResponseSchema = z.object({
  imported: z.number().int(),
  skipped: z.number().int(),   // exact-hash dedup skips
  errors: z.number().int(),
  flagged: z.array(FlaggedDuplicateSchema), // fuzzy matches needing user review
  needsRouting: z.array(NeedsRoutingItemSchema), // transfer-kind txns with no routing rule
});

// ── Confirm flagged (step 3 — optional) ─────────────────────────────────────

export const ConfirmFlaggedBodySchema = z.object({
  // Rows from `flagged[]` the user chose to import anyway
  rows: z.array(z.object({
    date: z.string(),
    merchant: z.string().nullable(),
    amountMinor: z.number().int(),
  })),
});

// ── Types ────────────────────────────────────────────────────────────────────

export type CsvColumnMapping = z.infer<typeof CsvColumnMappingSchema>;
export type ImportPreviewResponse = z.infer<typeof ImportPreviewResponseSchema>;
export type ImportCommitBody = z.infer<typeof ImportCommitBodySchema>;
export type ImportCommitResponse = z.infer<typeof ImportCommitResponseSchema>;
export type FlaggedDuplicate = z.infer<typeof FlaggedDuplicateSchema>;
export type ConfirmFlaggedBody = z.infer<typeof ConfirmFlaggedBodySchema>;
