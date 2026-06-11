import { z } from 'zod';

const SUPPORTED_CURRENCIES = ['USD', 'EUR', 'GBP', 'INR'] as const;

// ─── Household ────────────────────────────────────────────────────────────────

export const CreateHouseholdBodySchema = z.object({
  name: z.string().min(1, 'Household name is required').max(100).trim(),
  baseCurrency: z.enum(SUPPORTED_CURRENCIES),
  monthStartDay: z.number().int().min(1).max(28),
});

export type CreateHouseholdBody = z.infer<typeof CreateHouseholdBodySchema>;

export const UpdateHouseholdBodySchema = z.object({
  name: z.string().min(1).max(100).trim().optional(),
  baseCurrency: z.enum(SUPPORTED_CURRENCIES).optional(),
  monthStartDay: z.number().int().min(1).max(28).optional(),
});

export type UpdateHouseholdBody = z.infer<typeof UpdateHouseholdBodySchema>;

export const HouseholdResponseSchema = z.object({
  id: z.string(),
  name: z.string(),
  baseCurrency: z.string(),
  monthStartDay: z.number(),
  createdAt: z.string(),
});

export type HouseholdResponse = z.infer<typeof HouseholdResponseSchema>;

// ─── Members ──────────────────────────────────────────────────────────────────

export const MemberResponseSchema = z.object({
  userId: z.string(),
  name: z.string(),
  email: z.string(),
  role: z.enum(['owner', 'member']),
  isPrimaryOwner: z.boolean(),
  joinedAt: z.string(),
  lastLoginAt: z.string().nullable(),
});

export type MemberResponse = z.infer<typeof MemberResponseSchema>;

export const UpdateMemberRoleBodySchema = z.object({
  role: z.enum(['owner', 'member']),
});

export type UpdateMemberRoleBody = z.infer<typeof UpdateMemberRoleBodySchema>;

// ─── Invites ──────────────────────────────────────────────────────────────────

export const InviteMemberBodySchema = z.object({
  email: z.string().email(),
  role: z.enum(['owner', 'member']),
});

export type InviteMemberBody = z.infer<typeof InviteMemberBodySchema>;

export const HouseholdInviteResponseSchema = z.object({
  id: z.string(),
  email: z.string(),
  role: z.enum(['owner', 'member']),
  status: z.enum(['pending', 'accepted', 'revoked']),
  expiresAt: z.string(),
  createdAt: z.string(),
});

export type HouseholdInviteResponse = z.infer<typeof HouseholdInviteResponseSchema>;

// Returned when a user looks up an invite token before accepting
export const InviteDetailsResponseSchema = z.object({
  id: z.string(),
  householdId: z.string(),
  householdName: z.string(),
  email: z.string(),
  role: z.enum(['owner', 'member']),
  expiresAt: z.string(),
});

export type InviteDetailsResponse = z.infer<typeof InviteDetailsResponseSchema>;
