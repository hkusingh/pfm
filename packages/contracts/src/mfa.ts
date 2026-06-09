import { z } from 'zod';

// ─── TOTP setup ───────────────────────────────────────────────────────────────

export const TotpSetupResponseSchema = z.object({
  otpauthUrl: z.string(),
  qrCodeDataUrl: z.string(),
  // Shown once — user must save these
  recoveryCodes: z.array(z.string()),
});

export type TotpSetupResponse = z.infer<typeof TotpSetupResponseSchema>;

export const TotpConfirmBodySchema = z.object({
  code: z.string().length(6),
});

export type TotpConfirmBody = z.infer<typeof TotpConfirmBodySchema>;

// ─── Email MFA setup ─────────────────────────────────────────────────────────

export const EmailMfaSetupBodySchema = z.object({
  // No body — code is sent to the user's email on request
});

export type EmailMfaSetupBody = z.infer<typeof EmailMfaSetupBodySchema>;

// ─── MFA verification (post-login) ───────────────────────────────────────────

export const MfaVerifyBodySchema = z.object({
  mfaChallengeToken: z.string().min(1),
  code: z.string().min(1),
});

export type MfaVerifyBody = z.infer<typeof MfaVerifyBodySchema>;

export const MfaVerifyResponseSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  expiresIn: z.number(),
});

export type MfaVerifyResponse = z.infer<typeof MfaVerifyResponseSchema>;

// ─── Recovery codes ───────────────────────────────────────────────────────────

export const MfaRecoverBodySchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  recoveryCode: z.string().min(1),
});

export type MfaRecoverBody = z.infer<typeof MfaRecoverBodySchema>;
