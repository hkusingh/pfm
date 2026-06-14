import { z } from 'zod';

// ─── E7.1 — KPI summary ───────────────────────────────────────────────────────

export const DashboardSummarySchema = z.object({
  netWorthMinor: z.number().int(),
  currency: z.string(),
  incomeMinor: z.number().int(),
  spendingMinor: z.number().int(),
  previousIncomeMinor: z.number().int().optional(),
  previousSpendingMinor: z.number().int().optional(),
  from: z.string(),
  to: z.string(),
});
export type DashboardSummary = z.infer<typeof DashboardSummarySchema>;

// ─── E7.2 — Spending by category ─────────────────────────────────────────────

export const SpendingByCategoryItemSchema = z.object({
  categoryId: z.string().nullable(),
  categoryName: z.string(),
  categoryColor: z.string().nullable(),
  amountMinor: z.number().int(),
});
export type SpendingByCategoryItem = z.infer<typeof SpendingByCategoryItemSchema>;

export const SpendingByCategoryResponseSchema = z.array(SpendingByCategoryItemSchema);
export type SpendingByCategoryResponse = z.infer<typeof SpendingByCategoryResponseSchema>;

// ─── E7.2 — Spending over time ────────────────────────────────────────────────

export const SpendingOverTimeItemSchema = z.object({
  month: z.string(),         // YYYY-MM
  spendingMinor: z.number().int(),
  incomeMinor: z.number().int(),
});
export type SpendingOverTimeItem = z.infer<typeof SpendingOverTimeItemSchema>;

export const SpendingOverTimeResponseSchema = z.array(SpendingOverTimeItemSchema);
export type SpendingOverTimeResponse = z.infer<typeof SpendingOverTimeResponseSchema>;
