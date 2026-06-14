import { z } from 'zod';

// ── Split transactions ────────────────────────────────────────────────────────

export const TransactionSplitItemSchema = z.object({
  id: z.string(),
  categoryId: z.string().nullable(),
  categoryName: z.string().nullable(),
  categoryColor: z.string().nullable(),
  amountMinor: z.number().int(),
});
export type TransactionSplitItem = z.infer<typeof TransactionSplitItemSchema>;

export const PutSplitsBodySchema = z.object({
  // User submits magnitudes (always positive); server applies the parent's sign.
  splits: z.array(z.object({
    categoryId: z.string().nullable(),
    amountMinor: z.number().int().positive(),
  })).min(2, 'At least two splits are required'),
});
export type PutSplitsBody = z.infer<typeof PutSplitsBodySchema>;

// ── Transaction list (household-level, visibility-scoped) ────────────────────

export const TransactionListItemSchema = z.object({
  id: z.string(),
  accountId: z.string(),
  accountName: z.string(),
  postedDate: z.string(),      // ISO date string YYYY-MM-DD
  merchant: z.string().nullable(),
  amountMinor: z.number(),
  currency: z.string(),
  categoryId: z.string().nullable(),
  categoryName: z.string().nullable(),
  categoryColor: z.string().nullable(),
  hasSplit: z.boolean(),
  splits: z.array(TransactionSplitItemSchema),
  isExcluded: z.boolean(),
  dedupHash: z.string(),
  createdAt: z.string(),
});
export type TransactionListItem = z.infer<typeof TransactionListItemSchema>;

export const TransactionListResponseSchema = z.object({
  items: z.array(TransactionListItemSchema),
  total: z.number(),
  totalAmountMinor: z.number().int(),
  totalExpenseMinor: z.number().int(),
  totalIncomeMinor: z.number().int(),
  page: z.number(),
  limit: z.number(),
});
export type TransactionListResponse = z.infer<typeof TransactionListResponseSchema>;

// ── Exclude transaction ───────────────────────────────────────────────────────

export const ExcludeTransactionBodySchema = z.object({
  isExcluded: z.boolean(),
});
export type ExcludeTransactionBody = z.infer<typeof ExcludeTransactionBodySchema>;

// ── Recategorize ─────────────────────────────────────────────────────────────

export const RecategorizeTxBodySchema = z.object({
  categoryId: z.string().nullable(),
  createRule: z.boolean().optional(),
});
export type RecategorizeTxBody = z.infer<typeof RecategorizeTxBodySchema>;

// ── Bulk apply-rules ─────────────────────────────────────────────────────────

export const ApplyRulesResponseSchema = z.object({
  classified: z.number(),
  total: z.number(),
});
export type ApplyRulesResponse = z.infer<typeof ApplyRulesResponseSchema>;
