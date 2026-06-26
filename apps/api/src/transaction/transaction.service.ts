import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { prisma } from '@pfm/db';
import { buildScope, canViewLineItems } from '@pfm/core';
import { merchantRuleKey, merchantSimilarityScore, MERCHANT_MATCH_THRESHOLD } from '@pfm/core';
import { EncryptionService } from '../common/encryption.service';
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
// amountMinor is string (encrypted) from DB; we decrypt before use
type RawTxWithIncludes = {
  id: string; accountId: string; postedDate: Date; merchant: string | null;
  amountMinor: string; currency: string; categoryId: string | null;
  hasSplit: boolean; isExcluded: boolean; externalTransfer: boolean; dedupHash: string; createdAt: Date;
  account: { name: string };
  category: { name: string; color: string | null } | null;
  splits: Array<{
    id: string; categoryId: string | null; amountMinor: number; // splits NOT encrypted
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

// After decryption: amounts are numbers, strings are plaintext
type DecryptedTxWithIncludes = Omit<RawTxWithIncludes, 'amountMinor' | 'merchant' | 'account' | 'transferPairAsDebit' | 'transferPairAsCredit' | 'awaitingCounterpart'> & {
  amountMinor: number;
  merchant: string | null;
  account: { name: string };
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

function txToListItem(t: DecryptedTxWithIncludes): TransactionListItem {
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
  categoryIds?: string;
  hasCategory?: boolean;
  from?: string;
  to?: string;
  page?: number;
  limit?: number;
  sortBy?: 'date' | 'amount';
  sortDir?: 'asc' | 'desc';
  hideLinked?: boolean;
}

@Injectable()
export class TransactionService {
  constructor(private readonly encryption: EncryptionService) {}

  // ── Decryption helpers ────────────────────────────────────────────────────

  private decAmt(enc: string, householdId: string): number {
    return parseInt(this.encryption.decrypt(enc, householdId), 10);
  }

  private decStr(enc: string | null, householdId: string): string | null {
    return enc ? this.encryption.decrypt(enc, householdId) : null;
  }

  private decryptTx(raw: RawTxWithIncludes, householdId: string): DecryptedTxWithIncludes {
    return {
      ...raw,
      amountMinor: this.decAmt(raw.amountMinor, householdId),
      merchant: this.decStr(raw.merchant, householdId),
      account: { name: this.encryption.decrypt(raw.account.name, householdId) },
      transferPairAsDebit: raw.transferPairAsDebit
        ? {
            ...raw.transferPairAsDebit,
            creditTx: {
              ...raw.transferPairAsDebit.creditTx,
              account: { name: this.encryption.decrypt(raw.transferPairAsDebit.creditTx.account.name, householdId) },
            },
          }
        : null,
      transferPairAsCredit: raw.transferPairAsCredit
        ? {
            ...raw.transferPairAsCredit,
            debitTx: {
              ...raw.transferPairAsCredit.debitTx,
              account: { name: this.encryption.decrypt(raw.transferPairAsCredit.debitTx.account.name, householdId) },
            },
          }
        : null,
      awaitingCounterpart: raw.awaitingCounterpart
        ? {
            id: raw.awaitingCounterpart.id,
            name: this.encryption.decrypt(raw.awaitingCounterpart.name, householdId),
          }
        : null,
    };
  }

  // ── E5.1 — Visibility-scoped list across all accessible accounts ──────────

  async listTransactions(
    householdId: string,
    viewerUserId: string,
    query: ListTransactionsQuery,
  ): Promise<TransactionListResponse> {
    const page = Math.max(1, query.page ?? 1);
    const limit = Math.min(100, Math.max(1, query.limit ?? 50));

    const allAccounts = await prisma.account.findMany({
      where: { householdId },
      select: { id: true, ownerUserId: true, visibility: true },
    });
    const scope = buildScope(viewerUserId, householdId, 'household', allAccounts);
    const visibleAccountIds = [...scope.lineItemAccountIds];

    if (visibleAccountIds.length === 0) {
      return { items: [], total: 0, totalAmountMinor: 0, totalExpenseMinor: 0, totalIncomeMinor: 0, page, limit };
    }

    const accountFilter = query.accountId
      ? (visibleAccountIds.includes(query.accountId) ? [query.accountId] : [])
      : visibleAccountIds;

    if (accountFilter.length === 0) {
      return { items: [], total: 0, totalAmountMinor: 0, totalExpenseMinor: 0, totalIncomeMinor: 0, page, limit };
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const where: any = {
      accountId: { in: accountFilter },
      ...(query.hideLinked ? { transferPairAsCredit: { is: null } } : {}),
    };
    // NOTE: merchant search removed from SQL — filtered in JS after decryption
    if (query.categoryIds !== undefined) {
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
        const children = await prisma.category.findMany({
          where: { parentId: query.categoryId },
          select: { id: true },
        });
        const ids = [query.categoryId, ...children.map((c) => c.id)];
        where.categoryId = ids.length === 1 ? ids[0] : { in: ids };
      }
    } else if (query.hasCategory === true) {
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

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sumWhere: any = { ...where, isExcluded: false };

    // Fetch rows for sum (all non-excluded) — decrypt amounts in JS
    const sumRows = await prisma.transaction.findMany({
      where: sumWhere,
      select: { amountMinor: true, category: { select: { kind: true } } },
    });

    let totalAmountMinor = 0;
    let totalExpenseMinor = 0;
    let totalIncomeMinor = 0;
    for (const tx of sumRows) {
      if (tx.category?.kind === 'transfer') continue;
      const amt = this.decAmt(tx.amountMinor, householdId);
      totalAmountMinor += amt;
      if (amt < 0) totalExpenseMinor += amt;
      else totalIncomeMinor += amt;
    }

    const needsSearchOrAmountSort = !!query.search || query.sortBy === 'amount';

    let total: number;
    let items: TransactionListItem[];

    if (needsSearchOrAmountSort) {
      // Fetch all rows, decrypt, filter by search, sort by amount if needed, then paginate in JS
      const allRows = (await prisma.transaction.findMany({
        where,
        include: TX_INCLUDE,
      })) as unknown as RawTxWithIncludes[];

      let decrypted: DecryptedTxWithIncludes[] = allRows.map((r) => this.decryptTx(r, householdId));

      if (query.search) {
        const searchLower = query.search.toLowerCase();
        decrypted = decrypted.filter((r) => r.merchant?.toLowerCase().includes(searchLower) ?? false);
      }

      if (query.sortBy === 'amount') {
        const dir = query.sortDir === 'asc' ? 1 : -1;
        decrypted.sort((a, b) => {
          if (a.amountMinor !== b.amountMinor) return dir * (a.amountMinor - b.amountMinor);
          return b.postedDate.getTime() - a.postedDate.getTime();
        });
      } else {
        const dir = query.sortDir === 'asc' ? 1 : -1;
        decrypted.sort((a, b) => {
          const d = dir * (a.postedDate.getTime() - b.postedDate.getTime());
          if (d !== 0) return d;
          return dir * (a.createdAt.getTime() - b.createdAt.getTime());
        });
      }

      total = decrypted.length;
      items = decrypted.slice((page - 1) * limit, page * limit).map(txToListItem);
    } else {
      // Default: date sort with SQL pagination
      const [totalCount, pageRows] = await Promise.all([
        prisma.transaction.count({ where }),
        prisma.transaction.findMany({
          where,
          orderBy: [
            { postedDate: query.sortDir === 'asc' ? 'asc' : 'desc' },
            { createdAt: query.sortDir === 'asc' ? 'asc' : 'desc' },
          ],
          skip: (page - 1) * limit,
          take: limit,
          include: TX_INCLUDE,
        }) as unknown as Promise<RawTxWithIncludes[]>,
      ]);
      total = totalCount;
      items = pageRows.map((r) => txToListItem(this.decryptTx(r, householdId)));
    }

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

    const [uncategorized, rules, transferCat, categorizedTxs] = await Promise.all([
      prisma.transaction.findMany({
        where: { accountId: { in: visibleAccountIds }, categoryId: null, hasSplit: false },
        select: { id: true, merchant: true },
      }),
      prisma.categoryRule.findMany({ where: { householdId } }),
      prisma.category.findFirst({ where: { householdId, kind: 'transfer', isSystem: true } }),
      prisma.transaction.findMany({
        where: { accountId: { in: visibleAccountIds }, categoryId: { not: null }, merchant: { not: null } },
        select: { merchant: true, categoryId: true },
      }),
    ]);

    if (uncategorized.length === 0) return { classified: 0, total: 0 };

    // Decrypt merchant names before rule matching
    const learnedMap = new Map<string, string>();
    const merchantCatCounts = new Map<string, Map<string, number>>();
    for (const t of categorizedTxs) {
      if (!t.merchant || !t.categoryId) continue;
      const plainMerchant = this.encryption.decrypt(t.merchant, householdId);
      const key = merchantRuleKey(plainMerchant);
      if (!key) continue;
      const m = merchantCatCounts.get(key) ?? new Map<string, number>();
      m.set(t.categoryId, (m.get(t.categoryId) ?? 0) + 1);
      merchantCatCounts.set(key, m);
    }
    for (const [key, catCounts] of merchantCatCounts) {
      let best = '';
      let bestCount = 0;
      for (const [catId, count] of catCounts) {
        if (count > bestCount) { bestCount = count; best = catId; }
      }
      if (best) learnedMap.set(key, best);
    }

    const resolve = (merchantRaw: string | null): string | null => {
      if (!merchantRaw) return null;
      const ruleKey = merchantRuleKey(merchantRaw);
      if (!ruleKey) return null;

      let bestScore = 0;
      let bestCatId: string | null = null;
      for (const rule of rules) {
        const s = merchantSimilarityScore(ruleKey, rule.merchantMatch);
        if (s > bestScore) { bestScore = s; bestCatId = rule.categoryId; }
      }
      if (bestScore >= MERCHANT_MATCH_THRESHOLD && bestCatId) return bestCatId;

      bestScore = 0;
      bestCatId = null;
      for (const [knownKey, catId] of learnedMap) {
        const s = merchantSimilarityScore(ruleKey, knownKey);
        if (s > bestScore) { bestScore = s; bestCatId = catId; }
      }
      if (bestScore >= MERCHANT_MATCH_THRESHOLD && bestCatId) return bestCatId;

      if (transferCat && TRANSFER_PATTERNS.some((p) => p.test(ruleKey))) {
        return transferCat.id;
      }

      return null;
    };

    const byCategoryId = new Map<string, string[]>();
    for (const tx of uncategorized) {
      // Decrypt merchant before rule matching
      const plainMerchant = tx.merchant ? this.encryption.decrypt(tx.merchant, householdId) : null;
      const catId = resolve(plainMerchant);
      if (catId) {
        const ids = byCategoryId.get(catId) ?? [];
        ids.push(tx.id);
        byCategoryId.set(catId, ids);
      }
    }

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
    const rawTx = await prisma.transaction.findUnique({
      where: { id: txId },
      include: {
        account: { select: { id: true, name: true, householdId: true, ownerUserId: true, visibility: true } },
        category: { select: { name: true, color: true } },
      },
    });
    if (!rawTx || rawTx.account.householdId !== householdId) {
      throw new NotFoundException('Transaction not found');
    }

    const allAccounts = await prisma.account.findMany({
      where: { householdId },
      select: { id: true, ownerUserId: true, visibility: true },
    });
    const scope = buildScope(viewerUserId, householdId, 'household', allAccounts);
    if (!canViewLineItems(scope, rawTx.accountId)) {
      throw new NotFoundException('Transaction not found');
    }

    if (rawTx.hasSplit) {
      await prisma.transactionSplit.deleteMany({ where: { transactionId: txId } });
    }

    const oldCat = rawTx.categoryId ? await prisma.category.findUnique({ where: { id: rawTx.categoryId } }) : null;
    const newCat = body.categoryId ? await prisma.category.findUnique({ where: { id: body.categoryId } }) : null;
    const leavingTransfer = oldCat?.kind === 'transfer' && newCat?.kind !== 'transfer';
    if (leavingTransfer) {
      await prisma.transferPair.deleteMany({
        where: { OR: [{ debitTxId: txId }, { creditTxId: txId }] },
      });
    }

    const updated = await prisma.transaction.update({
      where: { id: txId },
      data: {
        categoryId: body.categoryId,
        hasSplit: false,
        ...(leavingTransfer ? { awaitingCounterpartAccountId: null, externalTransfer: false } : {}),
      },
      include: TX_INCLUDE,
    }) as unknown as RawTxWithIncludes;

    if (body.createRule && body.categoryId && rawTx.merchant) {
      const plainMerchant = this.encryption.decrypt(rawTx.merchant, householdId);
      const ruleKey = merchantRuleKey(plainMerchant);
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
            data: { householdId, merchantMatch: ruleKey, categoryId: body.categoryId, createdByUserId: viewerUserId },
          });
        }
      }
    }

    return txToListItem(this.decryptTx(updated, householdId));
  }

  // ── E5.3 — Get single transaction ────────────────────────────────────────

  async getTransaction(txId: string, householdId: string, viewerUserId: string): Promise<TransactionListItem> {
    const tx = await this.findVerifiedTx(txId, householdId, viewerUserId);
    return txToListItem(this.decryptTx(tx as unknown as RawTxWithIncludes, householdId));
  }

  // ── E5.4 — Split transaction across categories ───────────────────────────

  async setSplits(txId: string, householdId: string, viewerUserId: string, body: PutSplitsBody): Promise<TransactionListItem> {
    const tx = await this.findVerifiedTx(txId, householdId, viewerUserId);
    const decAmount = this.decAmt(tx.amountMinor as unknown as string, householdId);

    const totalMagnitude = Math.abs(decAmount);
    const splitSum = body.splits.reduce((sum: number, s: { categoryId: string | null; amountMinor: number }) => sum + s.amountMinor, 0);
    if (splitSum !== totalMagnitude) {
      throw new BadRequestException(
        `Split amounts total ${splitSum} but transaction is ${totalMagnitude}. They must match exactly.`,
      );
    }

    const sign = decAmount >= 0 ? 1 : -1;

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

  // ── E10.5 — Exclude / include a transaction from calculations ───────────

  async excludeTransaction(
    txId: string,
    householdId: string,
    viewerUserId: string,
    body: ExcludeTransactionBody,
  ): Promise<TransactionListItem> {
    const tx = await this.findVerifiedTx(txId, householdId, viewerUserId);
    const decAmount = this.decAmt(tx.amountMinor as unknown as string, householdId);
    const decMerchant = this.decStr(tx.merchant as unknown as string | null, householdId);

    const updated = await prisma.transaction.update({
      where: { id: txId },
      data: { isExcluded: body.isExcluded },
      include: TX_INCLUDE,
    }) as unknown as RawTxWithIncludes;

    await prisma.auditLog.create({
      data: {
        householdId,
        actorUserId: viewerUserId,
        action: body.isExcluded ? 'transaction.exclude' : 'transaction.include',
        targetType: 'Transaction',
        targetId: txId,
        metadata: { merchant: decMerchant, amountMinor: decAmount },
      },
    });

    return txToListItem(this.decryptTx(updated, householdId));
  }

  // ── Delete transaction ───────────────────────────────────────────────────

  async deleteTransaction(txId: string, householdId: string, viewerUserId: string): Promise<void> {
    const tx = await this.findVerifiedTx(txId, householdId, viewerUserId);
    const decAmount = this.decAmt(tx.amountMinor as unknown as string, householdId);
    const decMerchant = this.decStr(tx.merchant as unknown as string | null, householdId);

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
        metadata: { merchant: decMerchant, amountMinor: decAmount, postedDate: tx.postedDate },
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

    const debitAmt = this.decAmt(debit.amountMinor, householdId);
    const creditAmt = this.decAmt(credit.amountMinor, householdId);

    if (debitAmt >= 0) throw new BadRequestException('debitTxId must be a negative (outflow) transaction');
    if (creditAmt <= 0) throw new BadRequestException('creditTxId must be a positive (inflow) transaction');
    if (Math.abs(debitAmt) !== creditAmt) throw new BadRequestException('Amounts do not match');

    const existing = await prisma.transferPair.findFirst({
      where: { OR: [{ debitTxId }, { creditTxId }] },
    });
    if (existing) throw new BadRequestException('One or both transactions are already linked');

    const pair = await prisma.transferPair.create({ data: { debitTxId, creditTxId } });
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
      const src = await prisma.account.findFirst({ where: { id: r.sourceAccountId, householdId } });
      if (!src) throw new NotFoundException(`Account ${r.sourceAccountId} not found`);
      if (r.counterpartAccountId) {
        const cpt = await prisma.account.findFirst({ where: { id: r.counterpartAccountId, householdId } });
        if (!cpt) throw new NotFoundException(`Account ${r.counterpartAccountId} not found`);
      }

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

      // Decrypt account name for response
      const counterpartAccountName = route.counterpartAccount?.name
        ? this.encryption.decrypt(route.counterpartAccount.name, householdId)
        : null;

      results.push({
        id: route.id,
        sourceAccountId: route.sourceAccountId,
        merchantMatch: route.merchantMatch,
        counterpartAccountId: route.counterpartAccountId,
        counterpartAccountName,
      });

      // Apply route to existing unlinked transactions — fetch by accountId then match merchant in JS
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
          select: { id: true, accountId: true, amountMinor: true, postedDate: true },
        });
        if (specific) {
          txsToApply.push({
            ...specific,
            amountMinor: this.decAmt(specific.amountMinor, householdId),
          });
        }
      }

      // Broad merchant scan: fetch candidates by account and filter by decrypted merchantNormalized
      if (r.merchantMatch) {
        const pattern = r.merchantMatch.toLowerCase().trim();
        const candidates = await prisma.transaction.findMany({
          where: {
            accountId: r.sourceAccountId,
            ...(r.txId ? { id: { not: r.txId } } : {}),
            transferPairAsDebit: null,
            transferPairAsCredit: null,
            awaitingCounterpartAccountId: null,
            externalTransfer: false,
          },
          select: { id: true, accountId: true, amountMinor: true, postedDate: true, merchantNormalized: true, merchant: true },
        });

        for (const c of candidates) {
          const normPlain = c.merchantNormalized
            ? this.encryption.decrypt(c.merchantNormalized, householdId)
            : null;
          const merchantPlain = c.merchant
            ? this.encryption.decrypt(c.merchant, householdId)
            : null;
          const matches = normPlain
            ? normPlain.includes(pattern)
            : merchantPlain
            ? merchantPlain.toLowerCase().includes(pattern)
            : false;
          if (matches) {
            txsToApply.push({
              id: c.id,
              accountId: c.accountId,
              amountMinor: this.decAmt(c.amountMinor, householdId),
              postedDate: c.postedDate,
            });
          }
        }
      }

      for (const tx of txsToApply) {
        if (!r.counterpartAccountId) {
          await prisma.transaction.update({ where: { id: tx.id }, data: { externalTransfer: true } });
        } else {
          await this.tryLink(tx, r.counterpartAccountId, householdId);
        }
      }

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
      const txAmount = this.decAmt(tx.amountMinor, householdId);
      const txMerchant = this.decStr(tx.merchant, householdId);
      const txMerchantNorm = this.decStr(tx.merchantNormalized, householdId);

      const alreadyLinked = await prisma.transferPair.findFirst({
        where: { OR: [{ debitTxId: tx.id }, { creditTxId: tx.id }] },
      });
      if (alreadyLinked) continue;

      // Step B: find transaction awaiting this account with matching amount
      const twoDay = 2 * 24 * 60 * 60 * 1000;
      const dateFrom = new Date(tx.postedDate.getTime() - twoDay);
      const dateTo = new Date(tx.postedDate.getTime() + twoDay);

      const awaitingCandidates = await prisma.transaction.findMany({
        where: {
          awaitingCounterpartAccountId: tx.accountId,
          postedDate: { gte: dateFrom, lte: dateTo },
          transferPairAsDebit: null,
          transferPairAsCredit: null,
        },
        select: { id: true, amountMinor: true },
      });

      const awaitingMatch = awaitingCandidates.find(
        (c) => this.decAmt(c.amountMinor, householdId) === -txAmount,
      );

      if (awaitingMatch) {
        const [debitId, creditId] = txAmount > 0
          ? [awaitingMatch.id, tx.id]
          : [tx.id, awaitingMatch.id];
        await prisma.transferPair.create({ data: { debitTxId: debitId, creditTxId: creditId } });
        await prisma.transaction.updateMany({
          where: { id: { in: [tx.id, awaitingMatch.id] } },
          data: { awaitingCounterpartAccountId: null },
        });
        continue;
      }

      // Step A: apply known routing rules (match against decrypted merchantNormalized)
      const matchedRoute = routes.find((r) => {
        if (r.sourceAccountId !== tx.accountId) return false;
        const pattern = r.merchantMatch.toLowerCase().trim();
        if (txMerchantNorm) return txMerchantNorm.includes(pattern);
        if (txMerchant) return txMerchant.toLowerCase().includes(pattern);
        return false;
      });

      if (matchedRoute) {
        if (!matchedRoute.counterpartAccountId) {
          await prisma.transaction.update({ where: { id: tx.id }, data: { externalTransfer: true } });
          continue;
        }
        await this.tryLink(
          { id: tx.id, accountId: tx.accountId, amountMinor: txAmount, postedDate: tx.postedDate },
          matchedRoute.counterpartAccountId,
          householdId,
        );
        continue;
      }

      // Step C: no routing rule — find a suggestion by date + amount
      const suggestionCandidates = await prisma.transaction.findMany({
        where: {
          account: { householdId },
          accountId: { not: tx.accountId },
          postedDate: { gte: dateFrom, lte: dateTo },
          categoryId: transferCat.id,
          transferPairAsDebit: null,
          transferPairAsCredit: null,
        },
        include: { account: { select: { name: true } } },
      });

      const suggestion = suggestionCandidates.find(
        (c) => this.decAmt(c.amountMinor, householdId) === -txAmount,
      );

      needsRouting.push({
        txId: tx.id,
        postedDate: tx.postedDate.toISOString().slice(0, 10),
        merchant: txMerchant,
        amountMinor: txAmount,
        suggestedCounterpartAccountId: suggestion?.accountId ?? null,
        suggestedCounterpartAccountName: suggestion
          ? this.encryption.decrypt(suggestion.account.name, householdId)
          : null,
      });
    }

    return needsRouting;
  }

  private async tryLink(
    tx: { id: string; accountId: string; amountMinor: number; postedDate: Date },
    counterpartAccountId: string,
    householdId: string,
  ): Promise<void> {
    const twoDay = 2 * 24 * 60 * 60 * 1000;
    const dateFrom = new Date(tx.postedDate.getTime() - twoDay);
    const dateTo = new Date(tx.postedDate.getTime() + twoDay);

    // Fetch candidates by date range; match amount after decryption
    const rawCandidates = await prisma.transaction.findMany({
      where: {
        accountId: counterpartAccountId,
        postedDate: { gte: dateFrom, lte: dateTo },
        transferPairAsDebit: null,
        transferPairAsCredit: null,
      },
      select: { id: true, amountMinor: true },
    });

    const candidates = rawCandidates.filter(
      (c) => this.decAmt(c.amountMinor, householdId) === -tx.amountMinor,
    );

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
      await prisma.transaction.update({
        where: { id: tx.id },
        data: { awaitingCounterpartAccountId: counterpartAccountId },
      });
    }
  }
}
