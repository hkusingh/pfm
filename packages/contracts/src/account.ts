import { z } from 'zod';

export const ACCOUNT_TYPES = [
  'checking',
  'savings',
  'credit_card',
  'investment',
  'loan',
  'mortgage',
  'other',
] as const;

export const VISIBILITY_KINDS = ['shared', 'private', 'balance_only'] as const;
export const SUPPORTED_CURRENCIES = ['USD', 'EUR', 'GBP', 'INR'] as const;

// ─── Account CRUD ─────────────────────────────────────────────────────────────

export const CreateAccountBodySchema = z.object({
  name: z.string().min(1).max(100).trim(),
  type: z.enum(ACCOUNT_TYPES),
  currency: z.enum(SUPPORTED_CURRENCIES),
  institution: z.string().max(100).trim().optional(),
  mask: z.string().max(10).trim().optional(),
  visibility: z.enum(VISIBILITY_KINDS).default('shared'),
  initialBalanceMinor: z.number().int().default(0),
});

export const UpdateAccountBodySchema = z.object({
  name: z.string().min(1).max(100).trim().optional(),
  type: z.enum(ACCOUNT_TYPES).optional(),
  institution: z.string().max(100).trim().optional(),
  mask: z.string().max(10).trim().optional(),
  balanceMinor: z.number().int().optional(),
});

export const UpdateVisibilityBodySchema = z.object({
  visibility: z.enum(VISIBILITY_KINDS),
});

export const AccountResponseSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.enum(ACCOUNT_TYPES),
  source: z.enum(['manual', 'import']),
  institution: z.string().nullable(),
  mask: z.string().nullable(),
  balanceMinor: z.number().int(),
  currency: z.string(),
  visibility: z.enum(VISIBILITY_KINDS),
  ownerUserId: z.string().nullable(),
  ownerName: z.string().nullable(),
  createdAt: z.string(),
});

export const AccountListResponseSchema = z.object({
  own: z.array(AccountResponseSchema),
  shared: z.array(AccountResponseSchema),
});

export type CreateAccountBody = z.infer<typeof CreateAccountBodySchema>;
export type UpdateAccountBody = z.infer<typeof UpdateAccountBodySchema>;
export type UpdateVisibilityBody = z.infer<typeof UpdateVisibilityBodySchema>;
export type AccountResponse = z.infer<typeof AccountResponseSchema>;
export type AccountListResponse = z.infer<typeof AccountListResponseSchema>;

// ─── Manual transactions ──────────────────────────────────────────────────────

export const CreateTransactionBodySchema = z.object({
  postedDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD'),
  merchant: z.string().max(200).trim().optional(),
  amountMinor: z.number().int(),
  currency: z.enum(SUPPORTED_CURRENCIES).optional(),
  categoryId: z.string().optional(),
});

export const UpdateTransactionBodySchema = CreateTransactionBodySchema.partial();

export const TransactionResponseSchema = z.object({
  id: z.string(),
  accountId: z.string(),
  postedDate: z.string(),
  merchant: z.string().nullable(),
  amountMinor: z.number().int(),
  currency: z.string(),
  categoryId: z.string().nullable(),
  dedupHash: z.string(),
  createdAt: z.string(),
});

export type CreateTransactionBody = z.infer<typeof CreateTransactionBodySchema>;
export type UpdateTransactionBody = z.infer<typeof UpdateTransactionBodySchema>;
export type TransactionResponse = z.infer<typeof TransactionResponseSchema>;
