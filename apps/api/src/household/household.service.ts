import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomBytes } from 'crypto';
import { prisma } from '@pfm/db';
import type {
  CreateHouseholdBody,
  UpdateHouseholdBody,
  InviteMemberBody,
  UpdateMemberRoleBody,
  HouseholdResponse,
  HouseholdInviteResponse,
  InviteDetailsResponse,
  MemberResponse,
} from '@pfm/contracts';
import { EmailService } from '../email/email.service';

@Injectable()
export class HouseholdService {
  constructor(private readonly email: EmailService) {}

  // ─── Helpers ──────────────────────────────────────────────────────────────

  private async requireMembership(householdId: string, userId: string) {
    const membership = await prisma.membership.findUnique({
      where: { householdId_userId: { householdId, userId } },
    });
    if (!membership || membership.status !== 'active') {
      throw new ForbiddenException('You are not a member of this household');
    }
    return membership;
  }

  private async requireOwner(householdId: string, userId: string) {
    const membership = await this.requireMembership(householdId, userId);
    if (membership.role !== 'owner') {
      throw new ForbiddenException('Only owners can perform this action');
    }
    return membership;
  }

  private formatHousehold(h: {
    id: string;
    name: string;
    baseCurrency: string;
    monthStartDay: number;
    createdAt: Date;
  }): HouseholdResponse {
    return {
      id: h.id,
      name: h.name,
      baseCurrency: h.baseCurrency,
      monthStartDay: h.monthStartDay,
      createdAt: h.createdAt.toISOString(),
    };
  }

  // ─── E1.1 Create household ─────────────────────────────────────────────────

  async createHousehold(userId: string, body: CreateHouseholdBody): Promise<HouseholdResponse> {
    const existing = await prisma.membership.findFirst({
      where: { userId, status: 'active' },
    });
    if (existing) {
      throw new ConflictException('You already belong to a household');
    }

    const household = await prisma.$transaction(async (tx) => {
      const h = await tx.household.create({
        data: {
          name: body.name,
          baseCurrency: body.baseCurrency,
          monthStartDay: body.monthStartDay,
        },
      });
      await tx.membership.create({
        data: {
          householdId: h.id,
          userId,
          role: 'owner',
          isPrimaryOwner: true,
        },
      });
      return h;
    });

    return this.formatHousehold(household);
  }

  // ─── E1.5 Get household & members ─────────────────────────────────────────

  async getMyHousehold(userId: string): Promise<HouseholdResponse> {
    const membership = await prisma.membership.findFirst({
      where: { userId, status: 'active' },
      include: { household: true },
    });
    if (!membership) {
      throw new NotFoundException('No household found');
    }
    return this.formatHousehold(membership.household);
  }

  async getHousehold(householdId: string, userId: string): Promise<HouseholdResponse> {
    await this.requireMembership(householdId, userId);
    const household = await prisma.household.findUniqueOrThrow({ where: { id: householdId } });
    return this.formatHousehold(household);
  }

  async updateHousehold(
    householdId: string,
    userId: string,
    body: UpdateHouseholdBody,
  ): Promise<HouseholdResponse> {
    await this.requireOwner(householdId, userId);

    const household = await prisma.household.update({
      where: { id: householdId },
      data: {
        ...(body.name !== undefined && { name: body.name }),
        ...(body.baseCurrency !== undefined && { baseCurrency: body.baseCurrency }),
        ...(body.monthStartDay !== undefined && { monthStartDay: body.monthStartDay }),
      },
    });

    await prisma.auditLog.create({
      data: {
        householdId,
        actorUserId: userId,
        action: 'household.settings_updated',
        targetType: 'Household',
        targetId: householdId,
        metadata: body,
      },
    });

    return this.formatHousehold(household);
  }

  async getMembers(householdId: string, userId: string): Promise<MemberResponse[]> {
    await this.requireMembership(householdId, userId);

    const memberships = await prisma.membership.findMany({
      where: { householdId, status: 'active' },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            sessions: {
              orderBy: { createdAt: 'desc' },
              take: 1,
              select: { createdAt: true },
            },
          },
        },
      },
      orderBy: { joinedAt: 'asc' },
    });

    return memberships.map((m) => ({
      userId: m.userId,
      name: m.user.name,
      email: m.user.email,
      role: m.role as 'owner' | 'member',
      isPrimaryOwner: m.isPrimaryOwner,
      joinedAt: m.joinedAt.toISOString(),
      lastLoginAt: m.user.sessions[0]?.createdAt.toISOString() ?? null,
    }));
  }

  // ─── E1.2 Invite member ────────────────────────────────────────────────────

  async inviteMember(
    householdId: string,
    actorUserId: string,
    body: InviteMemberBody,
  ): Promise<HouseholdInviteResponse> {
    await this.requireOwner(householdId, actorUserId);

    // Check email isn't already an active member
    const existingMember = await prisma.membership.findFirst({
      where: {
        householdId,
        status: 'active',
        user: { email: body.email.toLowerCase() },
      },
    });
    if (existingMember) {
      throw new ConflictException('This person is already a member of the household');
    }

    // Check no pending invite for this email
    const existingInvite = await prisma.invite.findFirst({
      where: {
        householdId,
        email: body.email.toLowerCase(),
        status: 'pending',
        expiresAt: { gt: new Date() },
      },
    });
    if (existingInvite) {
      throw new ConflictException('A pending invite already exists for this email address');
    }

    const token = randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    const invite = await prisma.invite.create({
      data: {
        householdId,
        email: body.email.toLowerCase(),
        role: body.role,
        token,
        expiresAt,
        invitedByUserId: actorUserId,
      },
    });

    const actor = await prisma.user.findUniqueOrThrow({
      where: { id: actorUserId },
      select: { name: true },
    });
    const household = await prisma.household.findUniqueOrThrow({
      where: { id: householdId },
      select: { name: true },
    });

    const webOrigin = process.env.WEB_ORIGIN ?? 'http://localhost:5173';
    await this.email.sendHouseholdInvite(
      body.email,
      actor.name,
      household.name,
      body.role,
      `${webOrigin}/invites/${token}`,
    );

    return {
      id: invite.id,
      email: invite.email,
      role: invite.role as 'owner' | 'member',
      status: 'pending',
      expiresAt: invite.expiresAt.toISOString(),
      createdAt: invite.createdAt.toISOString(),
    };
  }

  async listInvites(
    householdId: string,
    userId: string,
  ): Promise<HouseholdInviteResponse[]> {
    await this.requireOwner(householdId, userId);

    const invites = await prisma.invite.findMany({
      where: {
        householdId,
        status: 'pending',
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: 'desc' },
    });

    return invites.map((inv) => ({
      id: inv.id,
      email: inv.email,
      role: inv.role as 'owner' | 'member',
      status: 'pending' as const,
      expiresAt: inv.expiresAt.toISOString(),
      createdAt: inv.createdAt.toISOString(),
    }));
  }

  async resendInvite(householdId: string, inviteId: string, userId: string): Promise<void> {
    await this.requireOwner(householdId, userId);

    const invite = await prisma.invite.findFirst({
      where: { id: inviteId, householdId, status: 'pending' },
    });
    if (!invite) throw new NotFoundException('Invite not found');

    const actor = await prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { name: true },
    });
    const household = await prisma.household.findUniqueOrThrow({
      where: { id: householdId },
      select: { name: true },
    });

    const webOrigin = process.env.WEB_ORIGIN ?? 'http://localhost:5173';
    await this.email.sendHouseholdInvite(
      invite.email,
      actor.name,
      household.name,
      invite.role,
      `${webOrigin}/invites/${invite.token}`,
    );
  }

  async revokeInvite(householdId: string, inviteId: string, userId: string): Promise<void> {
    await this.requireOwner(householdId, userId);

    const invite = await prisma.invite.findFirst({
      where: { id: inviteId, householdId, status: 'pending' },
    });
    if (!invite) throw new NotFoundException('Invite not found');

    await prisma.invite.update({
      where: { id: inviteId },
      data: { status: 'revoked' },
    });
  }

  // ─── E1.3 Accept invite ────────────────────────────────────────────────────

  async getInviteDetails(token: string): Promise<InviteDetailsResponse> {
    const invite = await prisma.invite.findUnique({
      where: { token },
      include: { household: { select: { id: true, name: true } } },
    });

    if (!invite || invite.status !== 'pending' || invite.expiresAt < new Date()) {
      throw new NotFoundException('Invite not found or has expired');
    }

    return {
      id: invite.id,
      householdId: invite.householdId,
      householdName: invite.household.name,
      email: invite.email,
      role: invite.role as 'owner' | 'member',
      expiresAt: invite.expiresAt.toISOString(),
    };
  }

  async acceptInvite(token: string, userId: string): Promise<HouseholdResponse> {
    const invite = await prisma.invite.findUnique({
      where: { token },
      include: { household: true },
    });

    if (!invite || invite.status !== 'pending' || invite.expiresAt < new Date()) {
      throw new BadRequestException('Invite is invalid or has expired');
    }

    const user = await prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { email: true },
    });

    if (user.email.toLowerCase() !== invite.email.toLowerCase()) {
      throw new ForbiddenException('This invite was issued for a different email address');
    }

    const existing = await prisma.membership.findFirst({
      where: { userId, status: 'active' },
    });
    if (existing) {
      throw new ConflictException('You already belong to a household');
    }

    await prisma.$transaction(async (tx) => {
      await tx.membership.create({
        data: {
          householdId: invite.householdId,
          userId,
          role: invite.role,
          isPrimaryOwner: false,
        },
      });
      await tx.invite.update({
        where: { id: invite.id },
        data: { status: 'accepted' },
      });
      await tx.auditLog.create({
        data: {
          householdId: invite.householdId,
          actorUserId: userId,
          action: 'household.member_joined',
          targetType: 'Membership',
          targetId: userId,
          metadata: { role: invite.role },
        },
      });
    });

    return this.formatHousehold(invite.household);
  }

  // ─── E1.4 Manage roles & remove member ────────────────────────────────────

  async updateMemberRole(
    householdId: string,
    targetUserId: string,
    actorUserId: string,
    body: UpdateMemberRoleBody,
  ): Promise<void> {
    const actorMembership = await this.requireOwner(householdId, actorUserId);

    const targetMembership = await prisma.membership.findUnique({
      where: { householdId_userId: { householdId, userId: targetUserId } },
    });
    if (!targetMembership || targetMembership.status !== 'active') {
      throw new NotFoundException('Member not found');
    }

    // Cannot demote the primary owner to a non-owner role unless they transfer primary ownership
    if (targetMembership.isPrimaryOwner && body.role === 'member') {
      throw new BadRequestException(
        'Cannot demote the primary owner. Transfer primary ownership first.',
      );
    }

    // A non-primary owner cannot change their own role (only the primary owner / other owners can)
    if (actorUserId === targetUserId && !actorMembership.isPrimaryOwner) {
      throw new ForbiddenException('You cannot change your own role');
    }

    await prisma.membership.update({
      where: { householdId_userId: { householdId, userId: targetUserId } },
      data: { role: body.role },
    });

    await prisma.auditLog.create({
      data: {
        householdId,
        actorUserId,
        action: 'household.member_role_changed',
        targetType: 'Membership',
        targetId: targetUserId,
        metadata: { newRole: body.role },
      },
    });
  }

  async removeMember(
    householdId: string,
    targetUserId: string,
    actorUserId: string,
  ): Promise<void> {
    await this.requireOwner(householdId, actorUserId);

    const targetMembership = await prisma.membership.findUnique({
      where: { householdId_userId: { householdId, userId: targetUserId } },
    });
    if (!targetMembership || targetMembership.status !== 'active') {
      throw new NotFoundException('Member not found');
    }

    if (targetMembership.isPrimaryOwner) {
      throw new BadRequestException('Cannot remove the primary owner');
    }

    await prisma.$transaction(async (tx) => {
      await tx.membership.update({
        where: { householdId_userId: { householdId, userId: targetUserId } },
        data: { status: 'removed' },
      });

      // Detach the removed member's accounts from their ownership (set ownerUserId = null)
      await tx.account.updateMany({
        where: { householdId, ownerUserId: targetUserId },
        data: { ownerUserId: null },
      });

      await tx.auditLog.create({
        data: {
          householdId,
          actorUserId,
          action: 'household.member_removed',
          targetType: 'Membership',
          targetId: targetUserId,
        },
      });
    });
  }
}
