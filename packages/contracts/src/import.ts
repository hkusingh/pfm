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

export const ImportCommitResponseSchema = z.object({
  imported: z.number().int(),
  skipped: z.number().int(),   // dedup skips
  errors: z.number().int(),
});

// ── Types ────────────────────────────────────────────────────────────────────

export type CsvColumnMapping = z.infer<typeof CsvColumnMappingSchema>;
export type ImportPreviewResponse = z.infer<typeof ImportPreviewResponseSchema>;
export type ImportCommitBody = z.infer<typeof ImportCommitBodySchema>;
export type ImportCommitResponse = z.infer<typeof ImportCommitResponseSchema>;
