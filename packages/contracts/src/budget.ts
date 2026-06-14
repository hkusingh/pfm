import { z } from 'zod';

export const SINKING_FUND_CADENCES = ['annual', 'semi', 'quarterly'] as const;
export const SINKING_FUND_METHODS = ['amortized', 'actual'] as const;
export const SINKING_FUND_START_MODES = ['gradual', 'frontload'] as const;
export const RESERVE_STATUSES = ['ahead', 'on-track', 'behind'] as const;

export type SinkingFundCadence = (typeof SINKING_FUND_CADENCES)[number];
export type SinkingFundMethod = (typeof SINKING_FUND_METHODS)[number];
export type SinkingFundStartMode = (typeof SINKING_FUND_START_MODES)[number];
export type ReserveStatus = (typeof RESERVE_STATUSES)[number];

const PERIOD_RE = /^\d{4}-\d{2}$/; // YYYY-MM
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/; // YYYY-MM-DD

// ── E6.1 — Monthly budgets ──────────────────────────────────────────────────

export const BudgetResponseSchema = z.object({
  id: z.string(),
  householdId: z.string(),
  categoryId: z.string(),
  period: z.string(),
  amountMinor: z.number().int(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type BudgetResponse = z.infer<typeof BudgetResponseSchema>;

export const DEFAULT_BUDGET_PERIOD = '__default__';

export const UpsertBudgetBodySchema = z.object({
  categoryId: z.string(),
  // YYYY-MM for a month-specific override, or '__default__' for the template applied to all months.
  period: z.string().refine(
    (v) => PERIOD_RE.test(v) || v === DEFAULT_BUDGET_PERIOD,
    'period must be YYYY-MM or __default__',
  ),
  amountMinor: z.number().int().min(0),
});
export type UpsertBudgetBody = z.infer<typeof UpsertBudgetBodySchema>;

// ── E6.1/E6.2 — Budget summary (spent vs remaining, with sub-category rollups) ──

export interface BudgetSummaryItem {
  categoryId: string;
  categoryName: string;
  categoryColor: string | null;
  parentId: string | null;
  kind: 'expense' | 'income' | 'transfer';
  /** ID of the month-specific override record for the requested period, if one exists. */
  budgetId: string | null;
  /** ID of the __default__ template record, if one exists. */
  defaultBudgetId: string | null;
  /** Raw amount from the __default__ record (0 when no default is set). */
  defaultBudgetAmountMinor: number;
  /** True when there is a period-specific override (budgetId != null). */
  hasMonthOverride: boolean;
  budgetMinor: number;
  sinkingFundMinor: number;
  spentMinor: number;
  remainingMinor: number;
  children: BudgetSummaryItem[];
}

export const BudgetSummaryItemSchema: z.ZodType<BudgetSummaryItem> = z.lazy(() =>
  z.object({
    categoryId: z.string(),
    categoryName: z.string(),
    categoryColor: z.string().nullable(),
    parentId: z.string().nullable(),
    kind: z.enum(['expense', 'income', 'transfer']),
    budgetId: z.string().nullable(),
    defaultBudgetId: z.string().nullable(),
    defaultBudgetAmountMinor: z.number().int(),
    hasMonthOverride: z.boolean(),
    budgetMinor: z.number().int(),
    sinkingFundMinor: z.number().int(),
    spentMinor: z.number().int(),
    remainingMinor: z.number().int(),
    children: z.array(BudgetSummaryItemSchema),
  }),
);

export const BudgetSummaryResponseSchema = z.object({
  period: z.string(),
  currency: z.string(),
  items: z.array(BudgetSummaryItemSchema),
});
export type BudgetSummaryResponse = z.infer<typeof BudgetSummaryResponseSchema>;

// ── E6.3 — Sinking funds (virtual reserves) ─────────────────────────────────

export const SinkingFundResponseSchema = z.object({
  id: z.string(),
  householdId: z.string(),
  categoryId: z.string(),
  categoryName: z.string(),
  cadence: z.enum(SINKING_FUND_CADENCES),
  totalMinor: z.number().int(),
  nextDueDate: z.string(),
  method: z.enum(SINKING_FUND_METHODS),
  startMode: z.enum(SINKING_FUND_START_MODES),
  reserveBalanceMinor: z.number().int(),
  monthlyAmountMinor: z.number().int(),
  targetByNowMinor: z.number().int(),
  deltaMinor: z.number().int(),
  shortfallMinor: z.number().int(),
  status: z.enum(RESERVE_STATUSES),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type SinkingFundResponse = z.infer<typeof SinkingFundResponseSchema>;

export const CreateSinkingFundBodySchema = z.object({
  categoryId: z.string(),
  cadence: z.enum(SINKING_FUND_CADENCES),
  totalMinor: z.number().int().positive(),
  nextDueDate: z.string().regex(DATE_RE, 'nextDueDate must be YYYY-MM-DD'),
  method: z.enum(SINKING_FUND_METHODS).optional(),
  startMode: z.enum(SINKING_FUND_START_MODES).optional(),
});
export type CreateSinkingFundBody = z.infer<typeof CreateSinkingFundBodySchema>;

export const UpdateSinkingFundBodySchema = z.object({
  cadence: z.enum(SINKING_FUND_CADENCES).optional(),
  totalMinor: z.number().int().positive().optional(),
  nextDueDate: z.string().regex(DATE_RE, 'nextDueDate must be YYYY-MM-DD').optional(),
  method: z.enum(SINKING_FUND_METHODS).optional(),
  startMode: z.enum(SINKING_FUND_START_MODES).optional(),
  reserveBalanceMinor: z.number().int().min(0).optional(),
});
export type UpdateSinkingFundBody = z.infer<typeof UpdateSinkingFundBodySchema>;

// ── E6.4 — Income tracking (received vs expected, not a spend cap) ──────────

export const IncomeSummaryItemSchema = z.object({
  categoryId: z.string(),
  categoryName: z.string(),
  categoryColor: z.string().nullable(),
  expectedMinor: z.number().int(),
  receivedMinor: z.number().int(),
});
export type IncomeSummaryItem = z.infer<typeof IncomeSummaryItemSchema>;

export const IncomeSummaryResponseSchema = z.object({
  period: z.string(),
  currency: z.string(),
  items: z.array(IncomeSummaryItemSchema),
});
export type IncomeSummaryResponse = z.infer<typeof IncomeSummaryResponseSchema>;
