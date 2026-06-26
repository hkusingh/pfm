import { Injectable, UnauthorizedException } from '@nestjs/common';
import { SignJWT, jwtVerify } from 'jose';
import { createHash, randomBytes } from 'crypto';
import type { AccessTokenPayload } from '@pfm/contracts';
import { prisma } from '@pfm/db';

const ACCESS_TTL_SECONDS = 15 * 60;        // 15 min
const REFRESH_TTL_SECONDS = 30 * 24 * 3600; // 30 days
const DEMO_TTL_SECONDS = 2 * 3600;          // 2 hours

function accessSecret() {
  const s = process.env.JWT_ACCESS_SECRET;
  if (!s) throw new Error('JWT_ACCESS_SECRET is not set');
  return new TextEncoder().encode(s);
}


@Injectable()
export class TokenService {
  async issueTokenPair(
    userId: string,
    email: string,
    mfaVerified: boolean,
  ): Promise<{ accessToken: string; refreshToken: string; expiresIn: number }> {
    const accessToken = await new SignJWT({ sub: userId, email, mfaVerified })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime(`${ACCESS_TTL_SECONDS}s`)
      .sign(accessSecret());

    const rawRefresh = randomBytes(48).toString('hex');
    const tokenHash = createHash('sha256').update(rawRefresh).digest('hex');
    const expiresAt = new Date(Date.now() + REFRESH_TTL_SECONDS * 1000);

    await prisma.session.create({ data: { userId, tokenHash, expiresAt } });

    return { accessToken, refreshToken: rawRefresh, expiresIn: ACCESS_TTL_SECONDS };
  }

  async verifyAccessToken(token: string): Promise<AccessTokenPayload> {
    try {
      const { payload } = await jwtVerify(token, accessSecret());
      return payload as unknown as AccessTokenPayload;
    } catch {
      throw new UnauthorizedException('Invalid or expired access token');
    }
  }

  async rotateRefreshToken(
    rawRefreshToken: string,
  ): Promise<{ accessToken: string; refreshToken: string; expiresIn: number }> {
    const tokenHash = createHash('sha256').update(rawRefreshToken).digest('hex');
    const session = await prisma.session.findUnique({ where: { tokenHash } });

    if (!session || session.revokedAt || session.expiresAt < new Date()) {
      throw new UnauthorizedException('Refresh token invalid or expired');
    }

    // Rotate: revoke old session, issue new pair
    await prisma.session.update({ where: { id: session.id }, data: { revokedAt: new Date() } });

    const user = await prisma.user.findUniqueOrThrow({ where: { id: session.userId } });
    return this.issueTokenPair(user.id, user.email, true);
  }

  // Short-lived (2-hour) demo token — read-only, no refresh token, no session record.
  async issueDemoToken(userId: string, email: string): Promise<string> {
    return new SignJWT({ sub: userId, email, mfaVerified: true, isDemo: true })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime(`${DEMO_TTL_SECONDS}s`)
      .sign(accessSecret());
  }

  // Short-lived (1-hour) password reset token. Embeds a fingerprint of the
  // current password hash so the token is invalidated once the password changes.
  async issuePasswordResetToken(userId: string, passwordHash: string): Promise<string> {
    const fingerprint = createHash('sha256').update(passwordHash).digest('hex').slice(0, 16);
    return new SignJWT({ sub: userId, purpose: 'password_reset', fp: fingerprint })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(accessSecret());
  }

  async verifyPasswordResetToken(token: string): Promise<{ userId: string; fingerprint: string }> {
    try {
      const { payload } = await jwtVerify(token, accessSecret());
      const p = payload as Record<string, unknown>;
      if (p.purpose !== 'password_reset') throw new Error();
      return { userId: payload.sub as string, fingerprint: p.fp as string };
    } catch {
      throw new UnauthorizedException('Password reset link is invalid or has expired');
    }
  }

  // Short-lived (5-min) token used only to carry the MFA challenge step
  async issueMfaChallengeToken(userId: string): Promise<string> {
    return new SignJWT({ sub: userId, purpose: 'mfa_challenge' })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(accessSecret());
  }

  async verifyMfaChallengeToken(token: string): Promise<string> {
    try {
      const { payload } = await jwtVerify(token, accessSecret());
      if ((payload as Record<string, unknown>).purpose !== 'mfa_challenge') {
        throw new Error();
      }
      return payload.sub as string;
    } catch {
      throw new UnauthorizedException('MFA challenge token invalid or expired');
    }
  }
}
