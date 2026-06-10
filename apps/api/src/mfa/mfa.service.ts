import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { authenticator } from 'otplib';
import * as qrcode from 'qrcode';
import * as argon2 from 'argon2';
import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'crypto';
import { prisma } from '@pfm/db';
import { AuthService } from '../auth/auth.service';
import { TokenService } from '../auth/token.service';
import { EmailService } from '../email/email.service';
import type { MfaVerifyBody } from '@pfm/contracts';

// AES-256-GCM encryption for MFA secrets at rest
function encrypt(plaintext: string): string {
  const key = Buffer.from(process.env.ENCRYPTION_KEY ?? '', 'hex');
  if (key.length !== 32) throw new Error('ENCRYPTION_KEY must be 32 bytes (64 hex chars)');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString('base64');
}

function decrypt(ciphertext: string): string {
  const key = Buffer.from(process.env.ENCRYPTION_KEY ?? '', 'hex');
  const buf = Buffer.from(ciphertext, 'base64');
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const encrypted = buf.subarray(28);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return decipher.update(encrypted) + decipher.final('utf8');
}

const APP_NAME = process.env.PUBLIC_APP_NAME ?? 'PFM';
const EMAIL_CODE_TTL_MS = 10 * 60 * 1000; // 10 minutes

@Injectable()
export class MfaService {
  constructor(
    private readonly tokens: TokenService,
    private readonly email: EmailService,
  ) {}

  // ─── TOTP setup ─────────────────────────────────────────────────────────────

  async initTotpSetup(userId: string): Promise<{ otpauthUrl: string; qrCodeDataUrl: string; recoveryCodes: string[] }> {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });

    const secret = authenticator.generateSecret();
    const otpauthUrl = authenticator.keyuri(user.email, APP_NAME, secret);

    await prisma.mfaMethod.upsert({
      where: { id: `${userId}_totp_pending` },
      create: {
        id: `${userId}_totp_pending`,
        userId,
        type: 'totp',
        secret: encrypt(secret),
        isPrimary: false,
      },
      update: { secret: encrypt(secret) },
    });

    const qrCodeDataUrl = await qrcode.toDataURL(otpauthUrl);
    const { plain: recoveryCodes, hashed } = AuthService.generateRecoveryCodes();

    await prisma.recoveryCode.deleteMany({ where: { userId } });
    await prisma.recoveryCode.createMany({
      data: hashed.map((codeHash) => ({ userId, codeHash })),
    });

    return { otpauthUrl, qrCodeDataUrl, recoveryCodes };
  }

  async confirmTotpSetup(userId: string, code: string): Promise<void> {
    const pending = await prisma.mfaMethod.findUnique({
      where: { id: `${userId}_totp_pending` },
    });
    if (!pending) throw new NotFoundException('No pending TOTP setup');

    const secret = decrypt(pending.secret);
    if (!authenticator.verify({ token: code, secret })) {
      throw new BadRequestException('Invalid TOTP code');
    }

    await prisma.$transaction([
      prisma.mfaMethod.update({
        where: { id: pending.id },
        data: { isPrimary: true, confirmedAt: new Date() },
      }),
    ]);
  }

  // ─── Email MFA setup ────────────────────────────────────────────────────────

  async sendEmailMfaCode(userId: string): Promise<void> {
    const user = await prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { email: true },
    });

    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const codeHash = createHash('sha256').update(code).digest('hex');
    const payload = JSON.stringify({ codeHash, expiresAt: Date.now() + EMAIL_CODE_TTL_MS });

    await prisma.mfaMethod.upsert({
      where: { id: `${userId}_email_pending` },
      create: {
        id: `${userId}_email_pending`,
        userId,
        type: 'email',
        secret: encrypt(payload),
        isPrimary: false,
      },
      update: { secret: encrypt(payload) },
    });

    await this.email.sendMfaCode(user.email, code);
  }

  async confirmEmailMfaSetup(userId: string, code: string): Promise<void> {
    const pending = await prisma.mfaMethod.findUnique({
      where: { id: `${userId}_email_pending` },
    });
    if (!pending) throw new NotFoundException('No pending email MFA setup');

    this.verifyEmailCode(pending.secret, code);

    await prisma.mfaMethod.update({
      where: { id: pending.id },
      data: { isPrimary: true, confirmedAt: new Date() },
    });
  }

  // ─── MFA verification (post-login challenge) ─────────────────────────────────

  async verifyMfaChallenge(body: MfaVerifyBody): Promise<{ accessToken: string; refreshToken: string; expiresIn: number }> {
    const userId = await this.tokens.verifyMfaChallengeToken(body.mfaChallengeToken);

    const primaryMethod = await prisma.mfaMethod.findFirst({
      where: { userId, isPrimary: true, confirmedAt: { not: null } },
    });
    if (!primaryMethod) throw new ForbiddenException('No confirmed MFA method');

    if (primaryMethod.type === 'totp') {
      const secret = decrypt(primaryMethod.secret);
      if (!authenticator.verify({ token: body.code, secret })) {
        throw new BadRequestException('Invalid TOTP code');
      }
    } else {
      const emailMethod = await prisma.mfaMethod.findUnique({
        where: { id: `${userId}_email_pending` },
      });
      if (!emailMethod) throw new BadRequestException('No active email code; request a new one');
      this.verifyEmailCode(emailMethod.secret, body.code);
    }

    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    return this.tokens.issueTokenPair(user.id, user.email, true);
  }

  // ─── Recovery code login ─────────────────────────────────────────────────────

  async recoverViaCode(body: {
    email: string;
    password: string;
    recoveryCode: string;
  }): Promise<{ accessToken: string; refreshToken: string; expiresIn: number }> {
    const user = await prisma.user.findUnique({ where: { email: body.email } });

    const dummy = '$argon2id$v=19$m=65536,t=3,p=4$dummysaltfortimingggg$dummyhashvalue000000000000000000000000000';
    const valid = user
      ? await argon2.verify(user.passwordHash, body.password)
      : await argon2.verify(dummy, body.password).catch(() => false);

    if (!user || !valid) throw new BadRequestException('Invalid credentials');

    const codeHash = createHash('sha256').update(body.recoveryCode).digest('hex');
    const record = await prisma.recoveryCode.findFirst({
      where: { userId: user.id, codeHash, usedAt: null },
    });
    if (!record) throw new BadRequestException('Invalid or already-used recovery code');

    await prisma.recoveryCode.update({ where: { id: record.id }, data: { usedAt: new Date() } });

    return this.tokens.issueTokenPair(user.id, user.email, true);
  }

  // ─── Private helpers ────────────────────────────────────────────────────────

  private verifyEmailCode(encryptedPayload: string, submittedCode: string): void {
    const { codeHash, expiresAt } = JSON.parse(decrypt(encryptedPayload)) as {
      codeHash: string;
      expiresAt: number;
    };
    if (Date.now() > expiresAt) throw new BadRequestException('Email code expired');
    const submitted = createHash('sha256').update(submittedCode).digest('hex');
    if (submitted !== codeHash) throw new BadRequestException('Invalid email code');
  }
}
