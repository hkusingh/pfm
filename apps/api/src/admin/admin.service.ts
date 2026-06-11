import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { prisma } from '@pfm/db';
import type { RegistrationMode } from '@pfm/db';
import { EmailService } from '../email/email.service';

const INVITE_TTL_DAYS = 7;

@Injectable()
export class AdminService {
  constructor(private readonly email: EmailService) {}

  // ── Registration policy ────────────────────────────────────────────────────

  async getPolicy(): Promise<{ mode: RegistrationMode }> {
    const policy = await prisma.registrationPolicy.findUniqueOrThrow({ where: { id: 1 } });
    return { mode: policy.mode };
  }

  async setPolicy(mode: RegistrationMode, adminId: string): Promise<{ mode: RegistrationMode }> {
    const policy = await prisma.registrationPolicy.update({
      where: { id: 1 },
      data: { mode, updatedBy: adminId },
    });
    return { mode: policy.mode };
  }

  // ── Signup invites ─────────────────────────────────────────────────────────

  async listInvites() {
    return prisma.signupInvite.findMany({
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        email: true,
        expiresAt: true,
        usedAt: true,
        createdAt: true,
        issuedByAdmin: { select: { email: true } },
      },
    });
  }

  async createInvite(email: string, adminId: string): Promise<{ id: string; email: string }> {
    // One active (unused, unexpired) invite per email at a time
    const existing = await prisma.signupInvite.findFirst({
      where: { email, usedAt: null, expiresAt: { gt: new Date() } },
    });
    if (existing) {
      throw new BadRequestException('An active invite already exists for this email');
    }

    const token = randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000);

    const invite = await prisma.signupInvite.create({
      data: { email, token, expiresAt, issuedByAdminId: adminId },
    });

    const webOrigin = process.env.WEB_ORIGIN ?? 'http://localhost:5173';
    await this.email.sendSignupInvite(email, `${webOrigin}/signup?invite=${token}`);

    return { id: invite.id, email: invite.email };
  }

  async revokeInvite(id: string): Promise<void> {
    const invite = await prisma.signupInvite.findUnique({ where: { id } });
    if (!invite) throw new NotFoundException('Invite not found');
    if (invite.usedAt) throw new BadRequestException('Invite already used');
    // Mark as expired by setting expiresAt to now
    await prisma.signupInvite.update({
      where: { id },
      data: { expiresAt: new Date() },
    });
  }

  async resendInvite(id: string): Promise<void> {
    const invite = await prisma.signupInvite.findUnique({ where: { id } });
    if (!invite) throw new NotFoundException('Invite not found');
    if (invite.usedAt) throw new BadRequestException('Invite already used');

    const webOrigin = process.env.WEB_ORIGIN ?? 'http://localhost:5173';
    await this.email.sendSignupInvite(invite.email, `${webOrigin}/signup?invite=${invite.token}`);
  }

  // ── User list ──────────────────────────────────────────────────────────────

  async listUsers() {
    return prisma.user.findMany({
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        email: true,
        emailVerifiedAt: true,
        isSiteAdmin: true,
        createdAt: true,
        _count: { select: { memberships: true, mfaMethods: true } },
      },
    });
  }
}
