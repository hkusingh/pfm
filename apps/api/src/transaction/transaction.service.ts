import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { prisma } from '@pfm/db';
import { buildScope, canViewLineItems } from '@pfm/core';
import { merchantRuleKey, merchantSimilarityScore, MERCHANT_MATCH_THRESHOLD } from '@pfm/core';
import type { TransactionListItem, TransactionListResponse, RecategorizeTxBody, ApplyRulesResponse, PutSplitsBody, ExcludeTransactionBody, TransferPairResponse, TransferRouteResponse, TransferRouteBody, NeedsRoutingItem } from '@pfm/contracts';
import { TRANSFER_PATTERNS } from '../category/category.service';

// Prisma include object shared by all transaction queries
const TX_INCLUDE = {
  account: { select: { name: true } },
  category: { select: { name: true, color: true } },
  splits: { include: { category: { select: { name: true, color: true } } } },
  transferPairAsDebit: {
    select: {
      id: true,
      creditTxId: true,
      creditTx: { select: { accountId: true, account: { select: { name: true } } } },
    },
  },
  transferPairAsCredit: {
    select: {
      id: true,
      debitTxId: true,
      debitTx: { select: { accountId: true, account: { select: { name: true } } } },
    },
  },
  awaitingCounterpart: { select: { id: true, name: true } },
} as const;

// Shared shape returned by all Prisma queries that include account/category/splits
type TxWithIncludes = {
  id: string; accountId: string; postedDate: Date; merchant: string | null;
  amountMinor: number; currency: string; categoryId: string | null;
  hasSplit: boolean; isExcluded: boolean; externalTransfer: boolean; dedupHash: string; createdAt: Date;
  account: { name: string };
  category: { name: string; color: string | null } | null;
  splits: Array<{
    id: string; categoryId: string | null; amountMinor: number;
    category: { name: string; color: string | null } | null;
  }>;
  transferPairAsDebit: {
    id: string; creditTxId: string;
    creditTx: { accountId: string; account: { name: string } };
  } | null;
  transferPairAsCredit: {
    id: string; debitTxId: string;
    debitTx: { accountId: string; account: { name: string } };
  } | null;
  awaitingCounterpart: { id: string; name: string } | null;
};

function txToListItem(t: TxWithIncludes): TransactionListItem {
  let transferPair: TransactionListItem['transferPair'] = null;
  if (t.transferPairAsDebit) {
    transferPair = {
      pairId: t.transferPairAsDebit.id,
      counterpartTxId: t.transferPairAsDebit.creditTxId,
      counterpartAccountId: t.transferPairAsDebit.creditTx.accountId,
      counterpartAccountName: t.transferPairAsDebit.creditTx.account.name,
    };
  } else if (t.transferPairAsCredit) {
    transferPair = {
      pairId: t.transferPairAsCredit.id,
      counterpartTxId: t.transferPairAsCredit.debitTxId,
      counterpartAccountId: t.transferPairAsCredit.debitTx.accountId,
      counterpartAccountName: t.transferPairAsCredit.debitTx.account.name,
    };
  }

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
    isExcluded: t.isExcluded,
    externalTransfer: t.externalTransfer,
    splits: t.splits.map((s) => ({
      id: s.id,
      categoryId: s.categoryId,
      categoryName: s.category?.name ?? null,
      categoryColor: s.category?.color ?? null,
      amountMinor: s.amountMinor,
    })),
    dedupHash: t.dedupHash,
    createdAt: t.createdAt.toISOString(),
    transferPair,
    awaitingCounterpartAccount: t.awaitingCounterpart
      ? { id: t.awaitingCounterpart.id, name: t.awaitingCounterpart.name }
      : null,
  };
}

export interface ListTransactionsQuery {
  search?: string;
  accountId?: string;
  categoryId?: string;
  categoryIds?: string;   // comma-separated list; used for "Other" drill-down from Dashboard
  hasCategory?: boolean;
  from?: string;
  to?: string;
  page?: number;
  limit?: number;
  sortBy?: 'date' | 'amount';
  sortDir?: 'asc' | 'desc';
  hideLinked?: boolean;   // exclude the credit side of linked transfer pairs
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
      return { items: [], total: 0, totalAmountMinor: 0, totalExpenseMinor: 0, totalIncomeMinor: 0, page, limit };
    }

    // Apply filters
    const accountFilter = query.accountId
      ? (visibleAccountIds.includes(query.accountId) ? [query.accountId] : [])
      : visibleAccountIds;

    if (accountFilter.length === 0) {
      return { items: [], total: 0, totalAmountMinor: 0, totalExpenseMinor: 0, totalIncomeMinor: 0, page, limit };
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const where: any = {
      accountId: { in: accountFilter },
      // hideLinked: exclude credit-side transactions that are already linked to a debit in another account
      ...(query.hideLinked ? { transferPairAsCredit: { is: null } } : {}),
    };
    if (query.search) {
      where.merchant = { contains: query.search, mode: 'insensitive' };
    }
    if (query.categoryIds !== undefined) {
      // Multi-category filter (from Dashboard "Other" drill-down) — expand children for each parent ID
      const parentIds = query.categoryIds.split(',').filter(Boolean);
      const children = await prisma.category.findMany({
        where: { parentId: { in: parentIds } },
        select: { id: true },
      });
      const allIds = [...parentIds, ...children.map((c) => c.id)];
      where.categoryId = allIds.length === 1 ? allIds[0] : { in: allIds };
    } else if (query.categoryId !== undefined) {
      if (query.categoryId === 'uncategorized') {
        where.categoryId = null;
        where.hasSplit = false;
      } else {
        // Include all child categories so selecting a top-level filters all its sub-categories
        const children = await prisma.category.findMany({
          where: { parentId: query.categoryId },
          select: { id: true },
        });
        const ids = [query.categoryId, ...children.map((c) => c.id)];
        where.categoryId = ids.length === 1 ? ids[0] : { in: ids };
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

    // Sum at parent transaction level, excluding transfers and excluded transactions.
    // Done in JS so the transfer check (category.kind) uses a LEFT JOIN via findMany,
    // avoiding potential aggregate + OR relation filter issues.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sumWhere: any = { ...where, isExcluded: false };

    const [total, sumRows, rows] = await Promise.all([
      prisma.transaction.count({ where }),
      prisma.transaction.findMany({
        where: sumWhere,
        select: { amountMinor: true, category: { select: { kind: true } } },
      }),
      prisma.transaction.findMany({
        where,
        orderBy: query.sortBy === 'amount'
          ? [{ amountMinor: query.sortDir === 'asc' ? 'asc' : 'desc' }, { postedDate: 'desc' }]
          : [{ postedDate: query.sortDir === 'asc' ? 'asc' : 'desc' }, { createdAt: query.sortDir === 'asc' ? 'asc' : 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
        include: TX_INCLUDE,
      }),
    ]);

    let totalAmountMinor = 0;
    let totalExpenseMinor = 0;
    let totalIncomeMinor = 0;
    for (const tx of sumRows) {
      if (tx.category?.kind === 'transfer') continue;
      totalAmountMinor += tx.amountMinor;
      if (tx.amountMinor < 0) totalExpenseMinor += tx.amountMinor;
      else totalIncomeMinor += tx.amountMinor;
    }

    const items: TransactionListItem[] = rows.map(txToListItem);

    return { items, total, totalAmountMinor, totalExpenseMinor, totalIncomeMinor, page, limit };
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

    // When moving a transaction OUT of the Transfer category, clear all transfer-linking state
    const oldCat = tx.categoryId ? await prisma.category.findUnique({ where: { id: tx.categoryId } }) : null;
    const newCat = body.categoryId ? await prisma.category.findUnique({ where: { id: body.categoryId } }) : null;
    const leavingTransfer = oldCat?.kind === 'transfer' && newCat?.kind !== 'transfer';
    if (leavingTransfer) {
      // Remove pair (cascade deletes both sides' pair record)
      await prisma.transferPair.deleteMany({
        where: { OR: [{ debitTxId: txId }, { creditTxId: txId }] },
      });
    }

    // Update category — also clear transfer state when leaving Transfer
    const updated = await prisma.transaction.update({
      where: { id: txId },
      data: {
        categoryId: body.categoryId,
        hasSplit: false,
        ...(leavingTransfer ? { awaitingCounterpartAccountId: null, externalTransfer: false } : {}),
      },
      include: TX_INCLUDE,
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

  // ── E10.5 — Exclude / include a transaction from calculations ───────────

  async excludeTransaction(
    txId: string,
    householdId: string,
    viewerUserId: string,
    body: ExcludeTransactionBody,
  ): Promise<TransactionListItem> {
    const tx = await this.findVerifiedTx(txId, householdId, viewerUserId);

    const updated = await prisma.transaction.update({
      where: { id: txId },
      data: { isExcluded: body.isExcluded },
      include: TX_INCLUDE,
    });

    await prisma.auditLog.create({
      data: {
        householdId,
        actorUserId: viewerUserId,
        action: body.isExcluded ? 'transaction.exclude' : 'transaction.include',
        targetType: 'Transaction',
        targetId: txId,
        metadata: { merchant: tx.merchant, amountMinor: tx.amountMinor },
      },
    });

    return txToListItem(updated);
  }

  // ── Delete transaction ───────────────────────────────────────────────────

  async deleteTransaction(txId: string, householdId: string, viewerUserId: string): Promise<void> {
    const tx = await this.findVerifiedTx(txId, householdId, viewerUserId);

    // Delete splits first (no cascade), then the transaction itself.
    await prisma.$transaction([
      prisma.transactionSplit.deleteMany({ where: { transactionId: txId } }),
      prisma.transaction.delete({ where: { id: txId } }),
    ]);

    await prisma.auditLog.create({
      data: {
        householdId,
        actorUserId: viewerUserId,
        action: 'transaction.delete',
        targetType: 'Transaction',
        targetId: txId,
        metadata: { merchant: tx.merchant, amountMinor: tx.amountMinor, postedDate: tx.postedDate },
      },
    });
  }

  // ── Shared helpers ───────────────────────────────────────────────────────

  private async findVerifiedTx(txId: string, householdId: string, viewerUserId: string) {
    const tx = await prisma.transaction.findUnique({
      where: { id: txId },
      include: {
        ...TX_INCLUDE,
        account: { select: { id: true, name: true, householdId: true, ownerUserId: true, visibility: true } },
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

  // ── Transfer pair: manual link / unlink ───────────────────────────────────

  async linkTransferPair(
    debitTxId: string,
    creditTxId: string,
    householdId: string,
  ): Promise<TransferPairResponse> {
    const [debit, credit] = await Promise.all([
      prisma.transaction.findUnique({ where: { id: debitTxId }, include: { account: { select: { householdId: true } } } }),
      prisma.transaction.findUnique({ where: { id: creditTxId }, include: { account: { select: { householdId: true } } } }),
    ]);

    if (!debit || debit.account.householdId !== householdId) throw new NotFoundException('Debit transaction not found');
    if (!credit || credit.account.householdId !== householdId) throw new NotFoundException('Credit transaction not found');
    if (debit.accountId === credit.accountId) throw new BadRequestException('Transactions must be in different accounts');
    if (debit.amountMinor >= 0) throw new BadRequestException('debitTxId must be a negative (outflow) transaction');
    if (credit.amountMinor <= 0) throw new BadRequestException('creditTxId must be a positive (inflow) transaction');
    if (Math.abs(debit.amountMinor) !== credit.amountMinor) throw new BadRequestException('Amounts do not match');

    const existing = await prisma.transferPair.findFirst({
      where: { OR: [{ debitTxId }, { creditTxId }] },
    });
    if (existing) throw new BadRequestException('One or both transactions are already linked');

    const pair = await prisma.transferPair.create({ data: { debitTxId, creditTxId } });
    // Clear awaiting flags on both sides
    await prisma.transaction.updateMany({
      where: { id: { in: [debitTxId, creditTxId] } },
      data: { awaitingCounterpartAccountId: null },
    });

    return { pairId: pair.id, debitTxId, creditTxId };
  }

  async unlinkTransferPair(pairId: string, householdId: string): Promise<void> {
    const pair = await prisma.transferPair.findUnique({
      where: { id: pairId },
      include: { debitTx: { include: { account: { select: { householdId: true } } } } },
    });
    if (!pair || pair.debitTx.account.householdId !== householdId) throw new NotFoundException('Transfer pair not found');
    await prisma.transferPair.delete({ where: { id: pairId } });
  }

  // ── Transfer routes: save / delete ────────────────────────────────────────

  async createTransferRoutes(
    routes: TransferRouteBody[],
    householdId: string,
    userId?: string,
  ): Promise<TransferRouteResponse[]> {
    const results: TransferRouteResponse[] = [];
    for (const r of routes) {
      // Validate account belongs to household
      const src = await prisma.account.findFirst({ where: { id: r.sourceAccountId, householdId } });
      if (!src) throw new NotFoundException(`Account ${r.sourceAccountId} not found`);
      if (r.counterpartAccountId) {
        const cpt = await prisma.account.findFirst({ where: { id: r.counterpartAccountId, householdId } });
        if (!cpt) throw new NotFoundException(`Account ${r.counterpartAccountId} not found`);
      }

      // When re-routing a specific transaction, clear its existing transfer state first
      if (r.txId) {
        await prisma.transferPair.deleteMany({
          where: { OR: [{ debitTxId: r.txId }, { creditTxId: r.txId }] },
        });
        await prisma.transaction.update({
          where: { id: r.txId },
          data: { awaitingCounterpartAccountId: null, externalTransfer: false },
        });
      }

      const route = await prisma.transferRoute.upsert({
        where: { sourceAccountId_merchantMatch: { sourceAccountId: r.sourceAccountId, merchantMatch: r.merchantMatch } },
        create: { householdId, sourceAccountId: r.sourceAccountId, merchantMatch: r.merchantMatch, counterpartAccountId: r.counterpartAccountId ?? null },
        update: { counterpartAccountId: r.counterpartAccountId ?? null },
        include: { counterpartAccount: { select: { name: true } } },
      });

      results.push({
        id: route.id,
        sourceAccountId: route.sourceAccountId,
        merchantMatch: route.merchantMatch,
        counterpartAccountId: route.counterpartAccountId,
        counterpartAccountName: route.counterpartAccount?.name ?? null,
      });

      // Apply this route immediately to existing unlinked transfer transactions.
      // Primary path: if a specific txId was supplied (per-row routing from UI), target it directly.
      // Fallback: broad merchant scan (case-insensitive) for any matching unlinked transactions.
      const txsToApply: { id: string; accountId: string; amountMinor: number; postedDate: Date }[] = [];

      if (r.txId) {
        const specific = await prisma.transaction.findFirst({
          where: {
            id: r.txId,
            accountId: r.sourceAccountId,
            transferPairAsDebit: null,
            transferPairAsCredit: null,
            awaitingCounterpartAccountId: null,
            externalTransfer: false,
          },
        });
        if (specific) txsToApply.push(specific);
      }

      // Also scan for any other unlinked transactions that match the merchant pattern
      if (r.merchantMatch) {
        const broad = await prisma.transaction.findMany({
          where: {
            accountId: r.sourceAccountId,
            merchantNormalized: { contains: r.merchantMatch.toLowerCase(), mode: 'insensitive' },
            ...(r.txId ? { id: { not: r.txId } } : {}),
            transferPairAsDebit: null,
            transferPairAsCredit: null,
            awaitingCounterpartAccountId: null,
            externalTransfer: false,
          },
        });
        txsToApply.push(...broad);
      }

      for (const tx of txsToApply) {
        if (!r.counterpartAccountId) {
          await prisma.transaction.update({ where: { id: tx.id }, data: { externalTransfer: true } });
        } else {
          await this.tryLink(tx, r.counterpartAccountId);
        }
      }

      // Ensure future imports with this merchant are auto-categorized as Transfer so that
      // resolveTransferLinks picks them up during the import commit step.
      if (userId && r.merchantMatch) {
        const transferCat = await prisma.category.findFirst({ where: { householdId, kind: 'transfer', isSystem: true } });
        if (transferCat) {
          const ruleKey = r.merchantMatch.toLowerCase().trim();
          const existingRule = await prisma.categoryRule.findFirst({ where: { householdId, merchantMatch: ruleKey } });
          if (existingRule) {
            await prisma.categoryRule.update({ where: { id: existingRule.id }, data: { categoryId: transferCat.id } });
          } else {
            await prisma.categoryRule.create({
              data: { householdId, merchantMatch: ruleKey, categoryId: transferCat.id, createdByUserId: userId },
            });
          }
        }
      }
    }
    return results;
  }

  async deleteTransferRoute(routeId: string, householdId: string): Promise<void> {
    const route = await prisma.transferRoute.findFirst({ where: { id: routeId, householdId } });
    if (!route) throw new NotFoundException('Transfer route not found');
    await prisma.transferRoute.delete({ where: { id: routeId } });
  }

  // Apply all known routing rules to every currently-unrouted transfer transaction in the household.
  // Used by the "Auto-route all" action on the Needs Routing tab.
  async resolveAllRoutes(householdId: string): Promise<{ resolved: number }> {
    const transferCat = await prisma.category.findFirst({ where: { householdId, kind: 'transfer', isSystem: true } });
    if (!transferCat) return { resolved: 0 };

    const unroutedTxs = await prisma.transaction.findMany({
      where: {
        account: { householdId },
        categoryId: transferCat.id,
        transferPairAsDebit: null,
        transferPairAsCredit: null,
        awaitingCounterpartAccountId: null,
        externalTransfer: false,
      },
      select: { id: true },
    });

    if (unroutedTxs.length === 0) return { resolved: 0 };

    const before = unroutedTxs.length;
    await this.resolveTransferLinks(householdId, unroutedTxs.map((t) => t.id));

    // Count how many are now resolved (have a pair, awaiting, or external flag)
    const stillUnrouted = await prisma.transaction.count({
      where: {
        id: { in: unroutedTxs.map((t) => t.id) },
        transferPairAsDebit: null,
        transferPairAsCredit: null,
        awaitingCounterpartAccountId: null,
        externalTransfer: false,
      },
    });
    return { resolved: before - stillUnrouted };
  }

  // ── Transfer resolution — called by import service post-insert ────────────

  async resolveTransferLinks(
    householdId: string,
    newTxIds: string[],
  ): Promise<NeedsRoutingItem[]> {
    if (newTxIds.length === 0) return [];

    const transferCat = await prisma.category.findFirst({ where: { householdId, kind: 'transfer', isSystem: true } });
    if (!transferCat) return [];

    const newTxs = await prisma.transaction.findMany({
      where: { id: { in: newTxIds }, categoryId: transferCat.id },
      include: { account: { select: { householdId: true } } },
    });
    if (newTxs.length === 0) return [];

    const routes = await prisma.transferRoute.findMany({ where: { householdId } });
    const needsRouting: NeedsRoutingItem[] = [];

    for (const tx of newTxs) {
      // Already linked — skip
      const alreadyLinked = await prisma.transferPair.findFirst({
        where: { OR: [{ debitTxId: tx.id }, { creditTxId: tx.id }] },
      });
      if (alreadyLinked) continue;

      // Step B: check if any existing transaction is waiting for this account
      const twoDay = 2 * 24 * 60 * 60 * 1000;
      const dateFrom = new Date(tx.postedDate.getTime() - twoDay);
      const dateTo = new Date(tx.postedDate.getTime() + twoDay);
      const awaitingMatch = await prisma.transaction.findFirst({
        where: {
          awaitingCounterpartAccountId: tx.accountId,
          amountMinor: -tx.amountMinor,
          postedDate: { gte: dateFrom, lte: dateTo },
          transferPairAsDebit: null,
          transferPairAsCredit: null,
        },
      });
      if (awaitingMatch) {
        const [debitId, creditId] = tx.amountMinor > 0
          ? [awaitingMatch.id, tx.id]
          : [tx.id, awaitingMatch.id];
        await prisma.transferPair.create({ data: { debitTxId: debitId, creditTxId: creditId } });
        await prisma.transaction.updateMany({
          where: { id: { in: [tx.id, awaitingMatch.id] } },
          data: { awaitingCounterpartAccountId: null },
        });
        continue;
      }

      // Step A: apply known routing rules.
      // Compare merchantNormalized (already lowercased/cleaned at import time) against
      // the lowercased+trimmed merchantMatch so the comparison is case-insensitive and
      // robust to whitespace differences between raw merchant strings.
      const matchedRoute = routes.find((r) => {
        if (r.sourceAccountId !== tx.accountId) return false;
        const pattern = r.merchantMatch.toLowerCase().trim();
        if (tx.merchantNormalized) return tx.merchantNormalized.includes(pattern);
        if (tx.merchant) return tx.merchant.toLowerCase().includes(pattern);
        return false;
      });

      if (matchedRoute) {
        if (!matchedRoute.counterpartAccountId) {
          // External / not tracked — mark so it disappears from "Needs routing" tab
          await prisma.transaction.update({ where: { id: tx.id }, data: { externalTransfer: true } });
          continue;
        }
        await this.tryLink(tx, matchedRoute.counterpartAccountId);
        continue;
      }

      // Step C: no routing rule — collect for user assignment, with optional suggestion
      const suggestion = await prisma.transaction.findFirst({
        where: {
          account: { householdId },
          accountId: { not: tx.accountId },
          amountMinor: -tx.amountMinor,
          postedDate: { gte: dateFrom, lte: dateTo },
          categoryId: transferCat.id,
          transferPairAsDebit: null,
          transferPairAsCredit: null,
        },
        include: { account: { select: { name: true } } },
      });

      needsRouting.push({
        txId: tx.id,
        postedDate: tx.postedDate.toISOString().slice(0, 10),
        merchant: tx.merchant,
        amountMinor: tx.amountMinor,
        suggestedCounterpartAccountId: suggestion?.accountId ?? null,
        suggestedCounterpartAccountName: suggestion?.account.name ?? null,
      });
    }

    return needsRouting;
  }

  private async tryLink(
    tx: { id: string; accountId: string; amountMinor: number; postedDate: Date },
    counterpartAccountId: string,
  ): Promise<void> {
    const twoDay = 2 * 24 * 60 * 60 * 1000;
    const dateFrom = new Date(tx.postedDate.getTime() - twoDay);
    const dateTo = new Date(tx.postedDate.getTime() + twoDay);

    const candidates = await prisma.transaction.findMany({
      where: {
        accountId: counterpartAccountId,
        amountMinor: -tx.amountMinor,
        postedDate: { gte: dateFrom, lte: dateTo },
        transferPairAsDebit: null,
        transferPairAsCredit: null,
      },
    });

    if (candidates.length === 1) {
      const [debitId, creditId] = tx.amountMinor < 0
        ? [tx.id, candidates[0].id]
        : [candidates[0].id, tx.id];
      await prisma.transferPair.create({ data: { debitTxId: debitId, creditTxId: creditId } });
      await prisma.transaction.updateMany({
        where: { id: { in: [tx.id, candidates[0].id] } },
        data: { awaitingCounterpartAccountId: null },
      });
    } else {
      // Counterpart not yet imported (or ambiguous) — mark as awaiting
      await prisma.transaction.update({
        where: { id: tx.id },
        data: { awaitingCounterpartAccountId: counterpartAccountId },
      });
    }
  }
}
