import {
  ConflictException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import * as argon2 from 'argon2';
import { randomBytes, createHash } from 'crypto';
import { prisma } from '@pfm/db';
import type {
  SignupBody,
  LoginBody,
  LoginResponse,
  RefreshBody,
  RefreshResponse,
} from '@pfm/contracts';
import { TokenService } from './token.service';
import { EmailService } from '../email/email.service';

@Injectable()
export class AuthService {
  constructor(
    private readonly tokens: TokenService,
    private readonly email: EmailService,
  ) {}

  async signup(body: SignupBody & { inviteToken?: string }): Promise<{ userId: string; email: string }> {
    // Enforce registration policy before touching the user table
    const policy = await prisma.registrationPolicy.findUniqueOrThrow({ where: { id: 1 } });

    if (policy.mode === 'admin_invite') {
      if (!body.inviteToken) {
        throw new ForbiddenException('An invitation is required to create an account');
      }
      const invite = await prisma.signupInvite.findUnique({ where: { token: body.inviteToken } });
      if (!invite || invite.usedAt || invite.expiresAt < new Date()) {
        throw new ForbiddenException('Invite is invalid or has expired');
      }
      if (invite.email.toLowerCase() !== body.email.toLowerCase()) {
        throw new ForbiddenException('This invite was issued for a different email address');
      }
    }

    const existing = await prisma.user.findUnique({ where: { email: body.email } });
    if (existing) throw new ConflictException('Email already registered');

    const passwordHash = await argon2.hash(body.password);
    const user = await prisma.user.create({
      data: { email: body.email, passwordHash },
    });

    // Consume the invite so it can't be reused
    if (body.inviteToken) {
      await prisma.signupInvite.update({
        where: { token: body.inviteToken },
        data: { usedAt: new Date() },
      });
    }

    const token = await this.createEmailVerificationToken(user.id);
    const webOrigin = process.env.WEB_ORIGIN ?? 'http://localhost:5173';
    await this.email.sendEmailVerification(
      user.email,
      `${webOrigin}/verify-email?token=${token}`,
    );

    return { userId: user.id, email: user.email };
  }

  async login(body: LoginBody): Promise<LoginResponse> {
    const user = await prisma.user.findUnique({ where: { email: body.email } });

    // Always run argon2.verify to prevent timing attacks even when user not found
    const dummyHash =
      '$argon2id$v=19$m=65536,t=3,p=4$dummysaltdummysalt$dummyhashvaluedummyhashvaluedummyhashvalue';
    const passwordValid = user
      ? await argon2.verify(user.passwordHash, body.password)
      : await argon2.verify(dummyHash, body.password).catch(() => false);

    if (!user || !passwordValid) {
      throw new UnauthorizedException('Invalid email or password');
    }

    const primaryMfa = await prisma.mfaMethod.findFirst({
      where: { userId: user.id, isPrimary: true, confirmedAt: { not: null } },
    });

    if (primaryMfa) {
      const mfaChallengeToken = await this.tokens.issueMfaChallengeToken(user.id);
      return {
        status: 'mfa_required',
        mfaChallengeToken,
        mfaType: primaryMfa.type,
      };
    }

    // No confirmed MFA yet — issue tokens without mfaVerified flag.
    // The onboarding guard will enforce enrollment before they can reach app data.
    const pair = await this.tokens.issueTokenPair(user.id, user.email, false);
    return { status: 'ok', ...pair };
  }

  async refresh(body: RefreshBody): Promise<RefreshResponse> {
    return this.tokens.rotateRefreshToken(body.refreshToken);
  }

  async verifyEmail(token: string): Promise<void> {
    // Token is a signed JWT (alg HS256) with { sub: userId, purpose: 'email_verify' }
    // created at signup time. We verify and mark emailVerifiedAt.
    try {
      const { jwtVerify } = await import('jose');
      const secret = new TextEncoder().encode(process.env.JWT_ACCESS_SECRET);
      const { payload } = await jwtVerify(token, secret);
      if ((payload as Record<string, unknown>).purpose !== 'email_verify') throw new Error();
      await prisma.user.update({
        where: { id: payload.sub as string },
        data: { emailVerifiedAt: new Date() },
      });
    } catch {
      throw new UnauthorizedException('Email verification link is invalid or expired');
    }
  }

  // Called by the email service at signup to produce a short-lived verification link token
  async createEmailVerificationToken(userId: string): Promise<string> {
    const { SignJWT } = await import('jose');
    const secret = new TextEncoder().encode(process.env.JWT_ACCESS_SECRET);
    return new SignJWT({ sub: userId, purpose: 'email_verify' })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime('24h')
      .sign(secret);
  }

  async getMe(userId: string): Promise<{
    id: string;
    email: string;
    emailVerifiedAt: Date | null;
    isSiteAdmin: boolean;
    createdAt: Date;
    mfaMethods: { type: string; isPrimary: boolean; confirmedAt: Date | null }[];
  }> {
    const user = await prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { id: true, email: true, emailVerifiedAt: true, isSiteAdmin: true, createdAt: true },
    });
    const mfaMethods = await prisma.mfaMethod.findMany({
      where: { userId, confirmedAt: { not: null } },
      select: { type: true, isPrimary: true, confirmedAt: true },
    });
    return { ...user, mfaMethods: mfaMethods.map((m) => ({ ...m, type: m.type as string })) };
  }

  async logout(rawRefreshToken: string): Promise<void> {
    const tokenHash = createHash('sha256').update(rawRefreshToken).digest('hex');
    await prisma.session.updateMany({
      where: { tokenHash, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async forgotPassword(email: string): Promise<void> {
    const user = await prisma.user.findUnique({ where: { email } });
    // Always respond the same way — don't reveal whether the email exists
    if (!user) return;

    const token = await this.tokens.issuePasswordResetToken(user.id, user.passwordHash);
    const webOrigin = process.env.WEB_ORIGIN ?? 'http://localhost:5173';
    await this.email.sendPasswordReset(user.email, `${webOrigin}/reset-password?token=${token}`);
  }

  async resetPassword(token: string, newPassword: string): Promise<void> {
    const { userId, fingerprint } = await this.tokens.verifyPasswordResetToken(token);

    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });

    // Check the fingerprint still matches — ensures one-time use after password change
    const { createHash } = await import('crypto');
    const currentFingerprint = createHash('sha256')
      .update(user.passwordHash)
      .digest('hex')
      .slice(0, 16);
    if (currentFingerprint !== fingerprint) {
      throw new UnauthorizedException('Password reset link has already been used');
    }

    const passwordHash = await argon2.hash(newPassword);
    await prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id: userId }, data: { passwordHash } });
      // Revoke all sessions so any stolen tokens are invalidated
      await tx.session.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    });
  }

  // Used by the global JWT guard to look up the current user
  async validateUser(userId: string) {
    return prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, emailVerifiedAt: true },
    });
  }

  // Generates and stores 10 recovery codes; returns the plaintext (shown once)
  static generateRecoveryCodes(): { plain: string[]; hashed: string[] } {
    const plain: string[] = [];
    const hashed: string[] = [];
    for (let i = 0; i < 10; i++) {
      const code = randomBytes(10).toString('hex');
      plain.push(code);
      hashed.push(createHash('sha256').update(code).digest('hex'));
    }
    return { plain, hashed };
  }
}
