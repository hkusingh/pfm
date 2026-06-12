import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { prisma } from '@pfm/db';
import { buildScope, canViewLineItems } from '@pfm/core';
import { merchantRuleKey, merchantSimilarityScore, MERCHANT_MATCH_THRESHOLD } from '@pfm/core';
import type { TransactionListItem, TransactionListResponse, RecategorizeTxBody, ApplyRulesResponse, PutSplitsBody } from '@pfm/contracts';
import { TRANSFER_PATTERNS } from '../category/category.service';

// Shared shape returned by all Prisma queries that include account/category/splits
type TxWithIncludes = {
  id: string; accountId: string; postedDate: Date; merchant: string | null;
  amountMinor: number; currency: string; categoryId: string | null;
  hasSplit: boolean; dedupHash: string; createdAt: Date;
  account: { name: string };
  category: { name: string; color: string | null } | null;
  splits: Array<{
    id: string; categoryId: string | null; amountMinor: number;
    category: { name: string; color: string | null } | null;
  }>;
};

function txToListItem(t: TxWithIncludes): TransactionListItem {
  return {
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
    hasSplit: t.hasSplit,
    splits: t.splits.map((s) => ({
      id: s.id,
      categoryId: s.categoryId,
      categoryName: s.category?.name ?? null,
      categoryColor: s.category?.color ?? null,
      amountMinor: s.amountMinor,
    })),
    dedupHash: t.dedupHash,
    createdAt: t.createdAt.toISOString(),
  };
}

export interface ListTransactionsQuery {
  search?: string;
  accountId?: string;
  categoryId?: string;
  hasCategory?: boolean;
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
      if (query.categoryId === 'uncategorized') {
        where.categoryId = null;
        where.hasSplit = false;
      } else {
        where.categoryId = query.categoryId;
      }
    } else if (query.hasCategory === true) {
      // A split transaction counts as categorized even though categoryId is null
      where.OR = [{ categoryId: { not: null } }, { hasSplit: true }];
    } else if (query.hasCategory === false) {
      where.categoryId = null;
      where.hasSplit = false;
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
          splits: { include: { category: { select: { name: true, color: true } } } },
        },
      }),
    ]);

    const items: TransactionListItem[] = rows.map(txToListItem);

    return { items, total, page, limit };
  }

  // ── Bulk apply category rules to all uncategorized transactions ──────────

  async applyRulesToAll(householdId: string, viewerUserId: string): Promise<ApplyRulesResponse> {
    const allAccounts = await prisma.account.findMany({
      where: { householdId },
      select: { id: true, ownerUserId: true, visibility: true },
    });
    const scope = buildScope(viewerUserId, householdId, 'household', allAccounts);
    const visibleAccountIds = [...scope.lineItemAccountIds];

    if (visibleAccountIds.length === 0) return { classified: 0, total: 0 };

    // Fetch everything needed in parallel — no per-transaction queries
    const [uncategorized, rules, transferCat, categorizedTxs] = await Promise.all([
      prisma.transaction.findMany({
        where: { accountId: { in: visibleAccountIds }, categoryId: null, hasSplit: false },
        select: { id: true, merchant: true },
      }),
      prisma.categoryRule.findMany({ where: { householdId } }),
      prisma.category.findFirst({ where: { householdId, kind: 'transfer', isSystem: true } }),
      // Learn from transactions the user has already manually categorized
      prisma.transaction.findMany({
        where: { accountId: { in: visibleAccountIds }, categoryId: { not: null }, merchant: { not: null } },
        select: { merchant: true, categoryId: true },
      }),
    ]);

    if (uncategorized.length === 0) return { classified: 0, total: 0 };

    // Build learned map: merchantRuleKey → most-used categoryId.
    // Using merchantRuleKey (strips trailing numeric reference tokens) means
    // "WF HOME MTG 06/09" and "WF HOME MTG 07/09" both map to key "WF HOME MTG"
    // so one manual categorization classifies all months.
    const merchantCatCounts = new Map<string, Map<string, number>>();
    for (const t of categorizedTxs) {
      if (!t.merchant || !t.categoryId) continue;
      const key = merchantRuleKey(t.merchant);
      if (!key) continue;
      const m = merchantCatCounts.get(key) ?? new Map<string, number>();
      m.set(t.categoryId, (m.get(t.categoryId) ?? 0) + 1);
      merchantCatCounts.set(key, m);
    }
    const learnedMap = new Map<string, string>();
    for (const [key, catCounts] of merchantCatCounts) {
      let best = '';
      let bestCount = 0;
      for (const [catId, count] of catCounts) {
        if (count > bestCount) { bestCount = count; best = catId; }
      }
      if (best) learnedMap.set(key, best);
    }

    // In-memory resolution: explicit rules → learned → transfer patterns
    // Each stage uses multi-signal similarity scoring; returns the best match above threshold.
    const resolve = (merchantRaw: string | null): string | null => {
      if (!merchantRaw) return null;
      const ruleKey = merchantRuleKey(merchantRaw);
      if (!ruleKey) return null;

      // 1. Explicit category rules — best-scoring match above threshold
      let bestScore = 0;
      let bestCatId: string | null = null;
      for (const rule of rules) {
        const s = merchantSimilarityScore(ruleKey, rule.merchantMatch);
        if (s > bestScore) { bestScore = s; bestCatId = rule.categoryId; }
      }
      if (bestScore >= MERCHANT_MATCH_THRESHOLD && bestCatId) return bestCatId;

      // 2. Learned from previous manual categorizations — best-scoring match above threshold
      bestScore = 0;
      bestCatId = null;
      for (const [knownKey, catId] of learnedMap) {
        const s = merchantSimilarityScore(ruleKey, knownKey);
        if (s > bestScore) { bestScore = s; bestCatId = catId; }
      }
      if (bestScore >= MERCHANT_MATCH_THRESHOLD && bestCatId) return bestCatId;

      // 3. Transfer pattern auto-detection
      if (transferCat && TRANSFER_PATTERNS.some((p) => p.test(ruleKey))) {
        return transferCat.id;
      }

      return null;
    };

    // Resolve all uncategorized transactions in memory, then bulk-update per category
    const byCategoryId = new Map<string, string[]>(); // categoryId → txIds
    for (const tx of uncategorized) {
      const catId = resolve(tx.merchant);
      if (catId) {
        const ids = byCategoryId.get(catId) ?? [];
        ids.push(tx.id);
        byCategoryId.set(catId, ids);
      }
    }

    // One updateMany per distinct category (vs N individual updates)
    await Promise.all(
      [...byCategoryId.entries()].map(([catId, ids]) =>
        prisma.transaction.updateMany({ where: { id: { in: ids } }, data: { categoryId: catId } }),
      ),
    );

    const classified = [...byCategoryId.values()].reduce((sum, ids) => sum + ids.length, 0);
    return { classified, total: uncategorized.length };
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

    // Assigning a single category clears any existing split
    if (tx.hasSplit) {
      await prisma.transactionSplit.deleteMany({ where: { transactionId: txId } });
    }

    // Update category
    const updated = await prisma.transaction.update({
      where: { id: txId },
      data: { categoryId: body.categoryId, hasSplit: false },
      include: {
        account: { select: { name: true } },
        category: { select: { name: true, color: true } },
        splits: { include: { category: { select: { name: true, color: true } } } },
      },
    });

    // Optionally create/update a category rule for this merchant
    if (body.createRule && body.categoryId && tx.merchant) {
      const ruleKey = merchantRuleKey(tx.merchant);
      if (ruleKey) {
        const existing = await prisma.categoryRule.findFirst({
          where: { householdId, merchantMatch: ruleKey },
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
              merchantMatch: ruleKey,
              categoryId: body.categoryId,
              createdByUserId: viewerUserId,
            },
          });
        }
      }
    }

    return txToListItem(updated);
  }

  // ── E5.3 — Get single transaction (for split page) ───────────────────────

  async getTransaction(txId: string, householdId: string, viewerUserId: string): Promise<TransactionListItem> {
    const tx = await this.findVerifiedTx(txId, householdId, viewerUserId);
    return txToListItem(tx);
  }

  // ── E5.4 — Split transaction across categories ───────────────────────────

  async setSplits(txId: string, householdId: string, viewerUserId: string, body: PutSplitsBody): Promise<TransactionListItem> {
    const tx = await this.findVerifiedTx(txId, householdId, viewerUserId);

    const totalMagnitude = Math.abs(tx.amountMinor);
    const splitSum = body.splits.reduce((sum: number, s: { categoryId: string | null; amountMinor: number }) => sum + s.amountMinor, 0);
    if (splitSum !== totalMagnitude) {
      throw new BadRequestException(
        `Split amounts total ${splitSum} but transaction is ${totalMagnitude}. They must match exactly.`,
      );
    }

    // All splits carry the same sign as the parent transaction
    const sign = tx.amountMinor >= 0 ? 1 : -1;

    await prisma.$transaction([
      prisma.transactionSplit.deleteMany({ where: { transactionId: txId } }),
      prisma.transactionSplit.createMany({
        data: body.splits.map((s: { categoryId: string | null; amountMinor: number }) => ({
          transactionId: txId,
          categoryId: s.categoryId,
          amountMinor: sign * s.amountMinor,
        })),
      }),
      prisma.transaction.update({
        where: { id: txId },
        data: { hasSplit: true, categoryId: null },
      }),
    ]);

    return this.getTransaction(txId, householdId, viewerUserId);
  }

  async clearSplits(txId: string, householdId: string, viewerUserId: string): Promise<TransactionListItem> {
    await this.findVerifiedTx(txId, householdId, viewerUserId);
    await prisma.$transaction([
      prisma.transactionSplit.deleteMany({ where: { transactionId: txId } }),
      prisma.transaction.update({ where: { id: txId }, data: { hasSplit: false } }),
    ]);
    return this.getTransaction(txId, householdId, viewerUserId);
  }

  // ── Shared helpers ───────────────────────────────────────────────────────

  private async findVerifiedTx(txId: string, householdId: string, viewerUserId: string) {
    const tx = await prisma.transaction.findUnique({
      where: { id: txId },
      include: {
        account: { select: { id: true, name: true, householdId: true, ownerUserId: true, visibility: true } },
        category: { select: { name: true, color: true } },
        splits: { include: { category: { select: { name: true, color: true } } } },
      },
    });
    if (!tx || tx.account.householdId !== householdId) throw new NotFoundException('Transaction not found');

    const allAccounts = await prisma.account.findMany({
      where: { householdId },
      select: { id: true, ownerUserId: true, visibility: true },
    });
    const scope = buildScope(viewerUserId, householdId, 'household', allAccounts);
    if (!canViewLineItems(scope, tx.accountId)) throw new NotFoundException('Transaction not found');

    return tx;
  }
}
