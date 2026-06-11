import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { prisma } from '@pfm/db';
import type { RegistrationMode } from '@pfm/db';
import { EmailService } from '../email/email.service';

const INVITE_TTL_DAYS = 7;

@Injectable()
export class AdminService {
  private readonly logger = new Logger(AdminService.name);
  constructor(private readonly email: EmailService) {}

  // ── Registration policy ────────────────────────────────────────────────────

  async getPolicy(): Promise<{ mode: RegistrationMode; householdInviteQuota: number }> {
    const policy = await prisma.registrationPolicy.findUniqueOrThrow({ where: { id: 1 } });
    return { mode: policy.mode, householdInviteQuota: policy.householdInviteQuota };
  }

  async setPolicy(
    mode: RegistrationMode,
    adminId: string,
    householdInviteQuota?: number,
  ): Promise<{ mode: RegistrationMode; householdInviteQuota: number }> {
    const policy = await prisma.registrationPolicy.update({
      where: { id: 1 },
      data: {
        mode,
        updatedBy: adminId,
        ...(householdInviteQuota !== undefined ? { householdInviteQuota } : {}),
      },
    });
    return { mode: policy.mode, householdInviteQuota: policy.householdInviteQuota };
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

  async createInvite(email: string, adminId: string): Promise<{ id: string; email: string; signupUrl: string }> {
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
    const signupUrl = `${webOrigin}/signup?invite=${token}`;

    // Email is best-effort — invite is still valid if delivery fails (e.g. unverified sender domain)
    this.email.sendSignupInvite(email, signupUrl).catch((err: unknown) => {
      this.logger.warn(`Invite email to ${email} failed: ${String(err)} — share the URL manually: ${signupUrl}`);
    });

    return { id: invite.id, email: invite.email, signupUrl };
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

  // ── Site-admin promotion / demotion ────────────────────────────────────────

  async setSiteAdmin(targetId: string, actorId: string, isSiteAdmin: boolean): Promise<{ id: string; isSiteAdmin: boolean }> {
    if (targetId === actorId && !isSiteAdmin) {
      throw new BadRequestException('You cannot remove your own site-admin access');
    }
    return prisma.user.update({
      where: { id: targetId },
      data: { isSiteAdmin },
      select: { id: true, isSiteAdmin: true },
    });
  }
}
