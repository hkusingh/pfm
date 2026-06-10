import { Injectable, ForbiddenException } from '@nestjs/common';
import { prisma } from '@pfm/db';

interface ExportResult {
  exportedAt: string;
  profile: { id: string; email: string; emailVerifiedAt: Date | null; createdAt: Date };
  households: { name: string; householdId: string; role: string; status: string; joinedAt: Date | null }[];
  mfaMethods: { type: string; confirmed: boolean; createdAt: Date }[];
}

interface DeleteResult {
  deleted: boolean;
}

@Injectable()
export class PrivacyService {
  async exportUserData(userId: string): Promise<ExportResult> {
    const user = await prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        emailVerifiedAt: true,
        createdAt: true,
        memberships: {
          select: {
            householdId: true,
            role: true,
            status: true,
            joinedAt: true,
            household: { select: { name: true } },
          },
        },
        mfaMethods: {
          select: { type: true, confirmedAt: true, createdAt: true },
        },
      },
    });

    const householdIds = user.memberships.map((m) => m.householdId);
    if (householdIds.length > 0) {
      await prisma.auditLog.createMany({
        data: householdIds.map((householdId) => ({
          householdId,
          actorUserId: userId,
          action: 'USER_DATA_EXPORT',
          targetType: 'User',
          targetId: userId,
        })),
      });
    }

    return {
      exportedAt: new Date().toISOString(),
      profile: {
        id: user.id,
        email: user.email,
        emailVerifiedAt: user.emailVerifiedAt,
        createdAt: user.createdAt,
      },
      households: user.memberships.map((m) => ({
        name: m.household.name,
        householdId: m.householdId,
        role: m.role,
        status: m.status,
        joinedAt: m.joinedAt,
      })),
      mfaMethods: user.mfaMethods.map((m) => ({
        type: m.type,
        confirmed: m.confirmedAt !== null,
        createdAt: m.createdAt,
      })),
    };
  }

  async deleteUser(userId: string, confirmEmail: string): Promise<DeleteResult> {
    const user = await prisma.user.findUniqueOrThrow({
      where: { id: userId },
      include: {
        memberships: { select: { householdId: true, role: true } },
      },
    });

    if (user.email !== confirmEmail) {
      throw new ForbiddenException('Email confirmation does not match.');
    }

    // Block deletion if user is the sole owner of any household.
    for (const membership of user.memberships) {
      if (membership.role === 'owner') {
        const otherOwners = await prisma.membership.count({
          where: {
            householdId: membership.householdId,
            role: 'owner',
            userId: { not: userId },
          },
        });
        if (otherOwners === 0) {
          throw new ForbiddenException(
            'You are the sole owner of a household. Transfer ownership before deleting your account.',
          );
        }
      }
    }

    const householdIds = user.memberships.map((m) => m.householdId);

    await prisma.$transaction(async (tx) => {
      // Audit before destroying
      if (householdIds.length > 0) {
        await tx.auditLog.createMany({
          data: householdIds.map((householdId) => ({
            householdId,
            actorUserId: userId,
            action: 'USER_ACCOUNT_DELETED',
            targetType: 'User',
            targetId: userId,
            metadata: { email: user.email },
          })),
        });
      }

      await tx.membership.deleteMany({ where: { userId } });
      await tx.invite.deleteMany({ where: { invitedByUserId: userId } });
      await tx.session.deleteMany({ where: { userId } });
      await tx.recoveryCode.deleteMany({ where: { userId } });
      await tx.mfaMethod.deleteMany({ where: { userId } });

      // Anonymize instead of hard-delete to preserve audit log foreign keys.
      await tx.user.update({
        where: { id: userId },
        data: {
          email: `deleted-${userId}@deleted.invalid`,
          passwordHash: '',
          emailVerifiedAt: null,
        },
      });
    });

    return { deleted: true };
  }
}
