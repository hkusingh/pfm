import { z } from 'zod';

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
  dedupHash: z.string(),
  createdAt: z.string(),
});
export type TransactionListItem = z.infer<typeof TransactionListItemSchema>;

export const TransactionListResponseSchema = z.object({
  items: z.array(TransactionListItemSchema),
  total: z.number(),
  page: z.number(),
  limit: z.number(),
});
export type TransactionListResponse = z.infer<typeof TransactionListResponseSchema>;

// ── Recategorize ─────────────────────────────────────────────────────────────

export const RecategorizeTxBodySchema = z.object({
  categoryId: z.string().nullable(),
  createRule: z.boolean().optional(),
});
export type RecategorizeTxBody = z.infer<typeof RecategorizeTxBodySchema>;
