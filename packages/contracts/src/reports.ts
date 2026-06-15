import { z } from 'zod';

// ─── Shared enums ─────────────────────────────────────────────────────────────

export const ChartTypeSchema = z.enum(['bar', 'line', 'donut', 'stacked_bar']);
export type ChartType = z.infer<typeof ChartTypeSchema>;

export const ChartMeasureSchema = z.enum(['spending', 'income', 'count']);
export type ChartMeasure = z.infer<typeof ChartMeasureSchema>;

export const ChartGroupBySchema = z.enum(['category', 'merchant', 'month']);
export type ChartGroupBy = z.infer<typeof ChartGroupBySchema>;

export const ChartDateRangeSchema = z.enum(['3m', '6m', '12m', 'ytd']);
export type ChartDateRange = z.infer<typeof ChartDateRangeSchema>;

export const ChartViewSchema = z.enum(['household', 'personal']);
export type ChartView = z.infer<typeof ChartViewSchema>;

// ─── Spending by category over time ──────────────────────────────────────────
// Featured chart: stacked bars or lines, one series per category

export const SpendingByCategoryOverTimeParamsSchema = z.object({
  months: z.coerce.number().int().min(1).max(24).default(6),
  view: ChartViewSchema.default('household'),
  accountId: z.string().optional(),
  categoryIds: z.string().optional(), // comma-separated top-level category IDs; omit for top-4-by-spend default
});
export type SpendingByCategoryOverTimeParams = z.infer<typeof SpendingByCategoryOverTimeParamsSchema>;

export const SpendingByCategoryOverTimeResponseSchema = z.object({
  months: z.array(z.string()),  // e.g. ["2026-01", "2026-02", ...]
  categories: z.array(z.object({
    categoryId: z.string(),
    name: z.string(),
    color: z.string().nullable(),
    amounts: z.array(z.number().int()),  // parallel to months[]
  })),
});
export type SpendingByCategoryOverTimeResponse = z.infer<typeof SpendingByCategoryOverTimeResponseSchema>;

// ─── Period comparison ────────────────────────────────────────────────────────

export const PeriodComparisonParamsSchema = z.object({
  granularity: z.enum(['month', 'quarter', 'year']),
  period1: z.string().min(4),  // YYYY-MM / YYYY-QN / YYYY
  period2: z.string().min(4),
  view: ChartViewSchema.default('household'),
});
export type PeriodComparisonParams = z.infer<typeof PeriodComparisonParamsSchema>;

const ComparisonRowSchema = z.object({
  categoryId: z.string(),
  categoryName: z.string(),
  period1Minor: z.number().int(),
  period2Minor: z.number().int(),
  deltaMinor: z.number().int(),
  deltaPct: z.number().nullable(),
});

export const PeriodComparisonResponseSchema = z.object({
  period1Label: z.string(),
  period2Label: z.string(),
  rows: z.array(ComparisonRowSchema.extend({
    subRows: z.array(ComparisonRowSchema),
  })),
  totalPeriod1Minor: z.number().int(),
  totalPeriod2Minor: z.number().int(),
});
export type PeriodComparisonResponse = z.infer<typeof PeriodComparisonResponseSchema>;

// ─── Top merchants ────────────────────────────────────────────────────────────

export const TopMerchantsParamsSchema = z.object({
  months: z.coerce.number().int().min(1).max(24).default(6),
  view: ChartViewSchema.default('household'),
  limit: z.coerce.number().int().min(1).max(50).default(10),
});
export type TopMerchantsParams = z.infer<typeof TopMerchantsParamsSchema>;

export const TopMerchantsResponseSchema = z.object({
  merchants: z.array(z.object({
    name: z.string(),
    amountMinor: z.number().int(),
    count: z.number().int(),
  })),
});
export type TopMerchantsResponse = z.infer<typeof TopMerchantsResponseSchema>;

// ─── Net worth trend ──────────────────────────────────────────────────────────

export const NetWorthTrendParamsSchema = z.object({
  months: z.coerce.number().int().min(3).max(24).default(12),
});
export type NetWorthTrendParams = z.infer<typeof NetWorthTrendParamsSchema>;

export const NetWorthTrendResponseSchema = z.object({
  points: z.array(z.object({
    month: z.string(),
    netWorthMinor: z.number().int(),
  })),
});
export type NetWorthTrendResponse = z.infer<typeof NetWorthTrendResponseSchema>;

// ─── Saved charts ─────────────────────────────────────────────────────────────

export const ReportKeySchema = z.enum(['net_worth_trend', 'income_vs_expenses', 'cash_flow', 'spending_by_category']);
export type ReportKey = z.infer<typeof ReportKeySchema>;

export const CreateSavedChartBodySchema = z.object({
  name: z.string().min(1).max(100),
  chartType: ChartTypeSchema,
  measure: ChartMeasureSchema,
  groupBy: ChartGroupBySchema,
  dateRange: ChartDateRangeSchema,
  view: ChartViewSchema.default('household'),
  reportKey: ReportKeySchema.optional(),
  accountId: z.string().optional(),
  categoryId: z.string().optional(),
  isShared: z.boolean().default(false),
});
export type CreateSavedChartBody = z.infer<typeof CreateSavedChartBodySchema>;

export const SavedChartResponseSchema = z.object({
  id: z.string(),
  householdId: z.string(),
  creatorId: z.string(),
  name: z.string(),
  chartType: ChartTypeSchema,
  measure: ChartMeasureSchema,
  groupBy: ChartGroupBySchema,
  dateRange: ChartDateRangeSchema,
  view: ChartViewSchema,
  reportKey: ReportKeySchema.nullable(),
  accountId: z.string().nullable(),
  categoryId: z.string().nullable(),
  isShared: z.boolean(),
  sortOrder: z.number().int(),
  createdAt: z.string(),
});
export type SavedChartResponse = z.infer<typeof SavedChartResponseSchema>;

export const SavedChartsListResponseSchema = z.object({
  charts: z.array(SavedChartResponseSchema),
});
export type SavedChartsListResponse = z.infer<typeof SavedChartsListResponseSchema>;
