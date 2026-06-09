import {
  ConflictException,
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

@Injectable()
export class AuthService {
  constructor(private readonly tokens: TokenService) {}

  async signup(body: SignupBody): Promise<{ userId: string; email: string }> {
    const existing = await prisma.user.findUnique({ where: { email: body.email } });
    if (existing) throw new ConflictException('Email already registered');

    const passwordHash = await argon2.hash(body.password);
    const user = await prisma.user.create({
      data: { email: body.email, passwordHash },
    });

    // Email verification would be sent here in a full implementation (E0.3 scope).
    // For now the verification link would call POST /auth/verify-email with a signed token.

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

  async getMe(userId: string) {
    const user = await prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { id: true, email: true, emailVerifiedAt: true, createdAt: true },
    });
    const mfaMethods = await prisma.mfaMethod.findMany({
      where: { userId, confirmedAt: { not: null } },
      select: { type: true, isPrimary: true, confirmedAt: true },
    });
    return { ...user, mfaMethods };
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
