import { Injectable } from '@nestjs/common';
import { prisma } from '@pfm/db';
import { buildScope, type Scope } from '@pfm/core';

// Fetches household accounts from DB and builds the visibility Scope.
// Every controller/service method that reads account or transaction data
// MUST obtain a Scope via this factory before querying.
@Injectable()
export class ScopeFactory {
  async forViewer(
    viewerUserId: string,
    householdId: string,
    mode: 'household' | 'personal' = 'household',
  ): Promise<Scope> {
    const accounts = await prisma.account.findMany({
      where: { householdId },
      select: { id: true, ownerUserId: true, visibility: true },
    });

    // Cast visibility enum from Prisma to the string literal type in @pfm/core
    const normalized = accounts.map((a) => ({
      id: a.id,
      ownerUserId: a.ownerUserId,
      visibility: a.visibility as 'shared' | 'private' | 'balance_only',
    }));

    return buildScope(viewerUserId, householdId, mode, normalized);
  }
}
