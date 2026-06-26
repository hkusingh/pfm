import { z } from 'zod';

// ─── Signup ───────────────────────────────────────────────────────────────────

export const SignupBodySchema = z.object({
  email: z.string().email(),
  password: z.string().min(12, 'Password must be at least 12 characters').max(128),
  name: z.string().min(1, 'Name is required').max(100).trim(),
  inviteToken: z.string().optional(),
});

export type SignupBody = z.infer<typeof SignupBodySchema>;

export const SignupResponseSchema = z.object({
  userId: z.string(),
  email: z.string().email(),
  // Non-null when AUTH_GATE is off — email is auto-verified; client skips verify-email step
  emailVerifiedAt: z.string().nullable(),
});

export type SignupResponse = z.infer<typeof SignupResponseSchema>;

// ─── Email verification ───────────────────────────────────────────────────────

export const VerifyEmailBodySchema = z.object({
  token: z.string().min(1),
});

export type VerifyEmailBody = z.infer<typeof VerifyEmailBodySchema>;

// ─── Login ────────────────────────────────────────────────────────────────────

export const LoginBodySchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  deviceToken: z.string().optional(),
});

export type LoginBody = z.infer<typeof LoginBodySchema>;

// Login may succeed fully (user has active MFA) or require MFA completion.
export const LoginResponseSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('mfa_required'),
    // Short-lived token used only to complete MFA — not an access token
    mfaChallengeToken: z.string(),
    mfaType: z.enum(['totp', 'email']),
  }),
  z.object({
    status: z.literal('ok'),
    accessToken: z.string(),
    refreshToken: z.string(),
    expiresIn: z.number(),
    // true when MFA was verified (trusted device or full MFA flow); false when no MFA enrolled yet
    mfaVerified: z.boolean(),
  }),
]);

export type LoginResponse = z.infer<typeof LoginResponseSchema>;

// ─── Token refresh ────────────────────────────────────────────────────────────

export const RefreshBodySchema = z.object({
  refreshToken: z.string().min(1),
});

export type RefreshBody = z.infer<typeof RefreshBodySchema>;

export const RefreshResponseSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  expiresIn: z.number(),
});

export type RefreshResponse = z.infer<typeof RefreshResponseSchema>;

// ─── Update profile ───────────────────────────────────────────────────────────

export const UpdateProfileBodySchema = z.object({
  name: z.string().min(1, 'Name is required').max(100).trim(),
});
export type UpdateProfileBody = z.infer<typeof UpdateProfileBodySchema>;

export const UpdateProfileResponseSchema = z.object({
  id: z.string(),
  email: z.string(),
  name: z.string(),
});
export type UpdateProfileResponse = z.infer<typeof UpdateProfileResponseSchema>;

// ─── Current user ─────────────────────────────────────────────────────────────

export const MeResponseSchema = z.object({
  id: z.string(),
  email: z.string(),
  name: z.string(),
});
export type MeResponse = z.infer<typeof MeResponseSchema>;

// ─── Change password ──────────────────────────────────────────────────────────

export const ChangePasswordBodySchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(12, 'Password must be at least 12 characters').max(128),
});
export type ChangePasswordBody = z.infer<typeof ChangePasswordBodySchema>;

// ─── Token payload (internal — not a contract endpoint) ──────────────────────

export type AccessTokenPayload = {
  sub: string;       // userId
  email: string;
  mfaVerified: boolean;
  isDemo?: boolean;  // true for read-only demo sessions; no refresh token issued
  iat?: number;
  exp?: number;
};
