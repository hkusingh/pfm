import { z } from 'zod';

export const CATEGORY_KINDS = ['expense', 'income'] as const;

export const CATEGORY_COLORS = [
  '#2F855A', // green
  '#E53E3E', // red
  '#2E6DA4', // blue
  '#B9770E', // amber
  '#8e44ad', // purple
  '#7c8aa0', // slate
  '#319795', // teal
  '#1F8A4C', // forest
  '#F6AD55', // orange
  '#D53F8C', // pink
] as const;

const HEX_COLOR_RE = /^#[0-9A-Fa-f]{6}$/;

// ── Response shapes ──────────────────────────────────────────────────────────

export const CategoryResponseSchema = z.object({
  id: z.string(),
  householdId: z.string(),
  parentId: z.string().nullable(),
  name: z.string(),
  color: z.string().nullable(),
  sortOrder: z.number(),
  isSystem: z.boolean(),
  kind: z.enum(CATEGORY_KINDS),
  createdAt: z.string(),
});
export type CategoryResponse = z.infer<typeof CategoryResponseSchema>;

export const CategoryTreeNodeSchema: z.ZodType<CategoryTreeNode> = z.lazy(() =>
  CategoryResponseSchema.extend({
    children: z.array(CategoryResponseSchema),
  }),
);
export type CategoryTreeNode = CategoryResponse & { children: CategoryResponse[] };

// ── Request shapes ───────────────────────────────────────────────────────────

export const CreateCategoryBodySchema = z.object({
  name: z.string().min(1).max(50),
  parentId: z.string().optional(),
  color: z.string().regex(HEX_COLOR_RE).optional(),
  sortOrder: z.number().int().min(0).optional(),
  kind: z.enum(CATEGORY_KINDS).optional(),
});
export type CreateCategoryBody = z.infer<typeof CreateCategoryBodySchema>;

export const UpdateCategoryBodySchema = z.object({
  name: z.string().min(1).max(50).optional(),
  color: z.string().regex(HEX_COLOR_RE).nullable().optional(),
  sortOrder: z.number().int().min(0).optional(),
  parentId: z.string().nullable().optional(),
});
export type UpdateCategoryBody = z.infer<typeof UpdateCategoryBodySchema>;

export const DeleteCategoryBodySchema = z.object({
  // If the category has transactions, caller must provide where to move them.
  // Pass null to set categoryId → null (Uncategorized).
  reassignTo: z.string().nullable().optional(),
});
export type DeleteCategoryBody = z.infer<typeof DeleteCategoryBodySchema>;

// ── Category rules ───────────────────────────────────────────────────────────

export const CategoryRuleResponseSchema = z.object({
  id: z.string(),
  householdId: z.string(),
  merchantMatch: z.string(),
  categoryId: z.string(),
  categoryName: z.string(),
  createdAt: z.string(),
});
export type CategoryRuleResponse = z.infer<typeof CategoryRuleResponseSchema>;

export const CreateCategoryRuleBodySchema = z.object({
  merchantMatch: z.string().min(1).max(100),
  categoryId: z.string(),
});
export type CreateCategoryRuleBody = z.infer<typeof CreateCategoryRuleBodySchema>;
