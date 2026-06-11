import { Injectable, NotFoundException } from '@nestjs/common';
import { prisma } from '@pfm/db';
import { buildScope, canViewLineItems } from '@pfm/core';
import { normalizeMerchant } from '@pfm/core';
import type { TransactionListItem, TransactionListResponse, RecategorizeTxBody } from '@pfm/contracts';

export interface ListTransactionsQuery {
  search?: string;
  accountId?: string;
  categoryId?: string;
  from?: string;
  to?: string;
  page?: number;
  limit?: number;
}

@Injectable()
export class TransactionService {
  // ── E5.1 — Visibility-scoped list across all accessible accounts ──────────

  async listTransactions(
    householdId: string,
    viewerUserId: string,
    query: ListTransactionsQuery,
  ): Promise<TransactionListResponse> {
    const page = Math.max(1, query.page ?? 1);
    const limit = Math.min(100, Math.max(1, query.limit ?? 50));

    // Build visibility scope
    const allAccounts = await prisma.account.findMany({
      where: { householdId },
      select: { id: true, ownerUserId: true, visibility: true },
    });
    const scope = buildScope(viewerUserId, householdId, 'household', allAccounts);

    // Collect IDs of accounts whose line items this viewer may see
    const visibleAccountIds = [...scope.lineItemAccountIds];
    if (visibleAccountIds.length === 0) {
      return { items: [], total: 0, page, limit };
    }

    // Apply filters
    const accountFilter = query.accountId
      ? (visibleAccountIds.includes(query.accountId) ? [query.accountId] : [])
      : visibleAccountIds;

    if (accountFilter.length === 0) {
      return { items: [], total: 0, page, limit };
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const where: any = {
      accountId: { in: accountFilter },
    };
    if (query.search) {
      where.merchant = { contains: query.search, mode: 'insensitive' };
    }
    if (query.categoryId !== undefined) {
      where.categoryId = query.categoryId === 'uncategorized' ? null : query.categoryId;
    }
    if (query.from || query.to) {
      where.postedDate = {
        ...(query.from ? { gte: new Date(query.from) } : {}),
        ...(query.to ? { lte: new Date(query.to) } : {}),
      };
    }

    const [total, rows] = await Promise.all([
      prisma.transaction.count({ where }),
      prisma.transaction.findMany({
        where,
        orderBy: [{ postedDate: 'desc' }, { createdAt: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
        include: {
          account: { select: { name: true } },
          category: { select: { name: true, color: true } },
        },
      }),
    ]);

    const items: TransactionListItem[] = rows.map((t) => ({
      id: t.id,
      accountId: t.accountId,
      accountName: t.account.name,
      postedDate: t.postedDate.toISOString().slice(0, 10),
      merchant: t.merchant,
      amountMinor: t.amountMinor,
      currency: t.currency,
      categoryId: t.categoryId,
      categoryName: t.category?.name ?? null,
      categoryColor: t.category?.color ?? null,
      dedupHash: t.dedupHash,
      createdAt: t.createdAt.toISOString(),
    }));

    return { items, total, page, limit };
  }

  // ── E5.2 — Recategorize + optional rule ──────────────────────────────────

  async recategorize(
    txId: string,
    householdId: string,
    viewerUserId: string,
    body: RecategorizeTxBody,
  ): Promise<TransactionListItem> {
    // Verify the transaction belongs to an account in this household and is visible
    const tx = await prisma.transaction.findUnique({
      where: { id: txId },
      include: {
        account: { select: { id: true, name: true, householdId: true, ownerUserId: true, visibility: true } },
        category: { select: { name: true, color: true } },
      },
    });
    if (!tx || tx.account.householdId !== householdId) {
      throw new NotFoundException('Transaction not found');
    }

    // Visibility check — viewer must be able to see line items
    const allAccounts = await prisma.account.findMany({
      where: { householdId },
      select: { id: true, ownerUserId: true, visibility: true },
    });
    const scope = buildScope(viewerUserId, householdId, 'household', allAccounts);
    if (!canViewLineItems(scope, tx.accountId)) {
      throw new NotFoundException('Transaction not found');
    }

    // Update category
    const updated = await prisma.transaction.update({
      where: { id: txId },
      data: { categoryId: body.categoryId },
      include: {
        account: { select: { name: true } },
        category: { select: { name: true, color: true } },
      },
    });

    // Optionally create/update a category rule for this merchant
    if (body.createRule && body.categoryId && tx.merchant) {
      const normalized = normalizeMerchant(tx.merchant);
      if (normalized) {
        const existing = await prisma.categoryRule.findFirst({
          where: { householdId, merchantMatch: normalized },
        });
        if (existing) {
          await prisma.categoryRule.update({
            where: { id: existing.id },
            data: { categoryId: body.categoryId, createdByUserId: viewerUserId },
          });
        } else {
          await prisma.categoryRule.create({
            data: {
              householdId,
              merchantMatch: normalized,
              categoryId: body.categoryId,
              createdByUserId: viewerUserId,
            },
          });
        }
      }
    }

    return {
      id: updated.id,
      accountId: updated.accountId,
      accountName: updated.account.name,
      postedDate: updated.postedDate.toISOString().slice(0, 10),
      merchant: updated.merchant,
      amountMinor: updated.amountMinor,
      currency: updated.currency,
      categoryId: updated.categoryId,
      categoryName: updated.category?.name ?? null,
      categoryColor: updated.category?.color ?? null,
      dedupHash: updated.dedupHash,
      createdAt: updated.createdAt.toISOString(),
    };
  }
}
