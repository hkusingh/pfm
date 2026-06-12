import { Injectable } from '@nestjs/common';
import { prisma } from '@pfm/db';
import { buildScope } from '@pfm/core';
import type { DashboardSummary, SpendingByCategoryItem, SpendingOverTimeItem } from '@pfm/contracts';

// Minimal tx shape needed for income/spending aggregation (no name/color)
type TxForAgg = {
  amountMinor: number;
  postedDate: Date;
  hasSplit: boolean;
  categoryKind: string | null;
  splits: Array<{ amountMinor: number; categoryKind: string | null }>;
};

// Full tx shape needed for spending-by-category (includes name/color)
type TxForCategory = {
  amountMinor: number;
  hasSplit: boolean;
  categoryId: string | null;
  categoryName: string | null;
  categoryColor: string | null;
  categoryKind: string | null;
  splits: Array<{
    amountMinor: number;
    categoryId: string | null;
    categoryName: string | null;
    categoryColor: string | null;
    categoryKind: string | null;
  }>;
};

@Injectable()
export class DashboardService {
  private async getVisibleAccountIds(
    householdId: string,
    viewerUserId: string,
    view: 'household' | 'personal',
  ): Promise<string[]> {
    const allAccounts = await prisma.account.findMany({
      where: { householdId },
      select: { id: true, ownerUserId: true, visibility: true },
    });
    const scope = buildScope(viewerUserId, householdId, 'household', allAccounts);
    const ids = [...scope.lineItemAccountIds];
    if (view === 'personal') {
      const owned = new Set(allAccounts.filter((a) => a.ownerUserId === viewerUserId).map((a) => a.id));
      return ids.filter((id) => owned.has(id));
    }
    return ids;
  }

  // ── E7.1 — KPI summary ────────────────────────────────────────────────────

  async getSummary(
    householdId: string,
    viewerUserId: string,
    view: 'household' | 'personal',
    from: string,
    to: string,
  ): Promise<DashboardSummary> {
    const [household, accountIds] = await Promise.all([
      prisma.household.findUniqueOrThrow({ where: { id: householdId }, select: { baseCurrency: true } }),
      this.getVisibleAccountIds(householdId, viewerUserId, view),
    ]);

    const baseCurrency = household.baseCurrency;

    const [accounts, rows] = await Promise.all([
      prisma.account.findMany({
        where: { id: { in: accountIds } },
        select: { balanceMinor: true, currency: true, type: true },
      }),
      accountIds.length > 0
        ? prisma.transaction.findMany({
            where: { accountId: { in: accountIds }, postedDate: { gte: new Date(from), lte: new Date(to) } },
            select: {
              amountMinor: true,
              postedDate: true,
              hasSplit: true,
              category: { select: { kind: true } },
              splits: { select: { amountMinor: true, category: { select: { kind: true } } } },
            },
          })
        : Promise.resolve([]),
    ]);

    const LIABILITY_TYPES = new Set(['credit_card', 'loan', 'mortgage']);
    const netWorthMinor = accounts
      .filter((a) => a.currency === baseCurrency)
      .reduce((sum, a) => sum + (LIABILITY_TYPES.has(a.type) ? -a.balanceMinor : a.balanceMinor), 0);

    let incomeMinor = 0;
    let spendingMinor = 0;

    for (const tx of rows) {
      const items: TxForAgg = {
        amountMinor: tx.amountMinor,
        postedDate: tx.postedDate,
        hasSplit: tx.hasSplit,
        categoryKind: tx.category?.kind ?? null,
        splits: tx.splits.map((s) => ({ amountMinor: s.amountMinor, categoryKind: s.category?.kind ?? null })),
      };
      for (const { amountMinor, categoryKind } of this.lineItems(items)) {
        if (categoryKind === 'transfer') continue;
        if (amountMinor > 0) incomeMinor += amountMinor;
        else spendingMinor += Math.abs(amountMinor);
      }
    }

    return { netWorthMinor, currency: baseCurrency, incomeMinor, spendingMinor, from, to };
  }

  // ── E7.2 — Spending by category ───────────────────────────────────────────

  async getSpendingByCategory(
    householdId: string,
    viewerUserId: string,
    view: 'household' | 'personal',
    from: string,
    to: string,
  ): Promise<SpendingByCategoryItem[]> {
    const accountIds = await this.getVisibleAccountIds(householdId, viewerUserId, view);
    if (accountIds.length === 0) return [];

    const rows = await prisma.transaction.findMany({
      where: { accountId: { in: accountIds }, postedDate: { gte: new Date(from), lte: new Date(to) } },
      select: {
        amountMinor: true,
        hasSplit: true,
        categoryId: true,
        category: { select: { name: true, color: true, kind: true } },
        splits: {
          select: {
            amountMinor: true,
            categoryId: true,
            category: { select: { name: true, color: true, kind: true } },
          },
        },
      },
    });

    const map = new Map<string, { name: string; color: string | null; total: number }>();

    for (const tx of rows) {
      const catTx: TxForCategory = {
        amountMinor: tx.amountMinor,
        hasSplit: tx.hasSplit,
        categoryId: tx.categoryId,
        categoryName: tx.category?.name ?? null,
        categoryColor: tx.category?.color ?? null,
        categoryKind: tx.category?.kind ?? null,
        splits: tx.splits.map((s) => ({
          amountMinor: s.amountMinor,
          categoryId: s.categoryId,
          categoryName: s.category?.name ?? null,
          categoryColor: s.category?.color ?? null,
          categoryKind: s.category?.kind ?? null,
        })),
      };

      const items = catTx.hasSplit
        ? catTx.splits
        : [{ amountMinor: catTx.amountMinor, categoryId: catTx.categoryId, categoryName: catTx.categoryName, categoryColor: catTx.categoryColor, categoryKind: catTx.categoryKind }];

      for (const item of items) {
        if (item.categoryKind === 'transfer') continue;
        if (item.amountMinor >= 0) continue; // only expenses
        const key = item.categoryId ?? '__uncategorized__';
        const entry = map.get(key) ?? { name: item.categoryName ?? 'Uncategorized', color: item.categoryColor ?? null, total: 0 };
        entry.total += Math.abs(item.amountMinor);
        map.set(key, entry);
      }
    }

    return Array.from(map.entries())
      .map(([key, { name, color, total }]) => ({
        categoryId: key === '__uncategorized__' ? null : key,
        categoryName: name,
        categoryColor: color,
        amountMinor: total,
      }))
      .filter((d) => d.amountMinor > 0)
      .sort((a, b) => b.amountMinor - a.amountMinor);
  }

  // ── E7.2 — Spending over time ─────────────────────────────────────────────

  async getSpendingOverTime(
    householdId: string,
    viewerUserId: string,
    view: 'household' | 'personal',
    months: number,
  ): Promise<SpendingOverTimeItem[]> {
    const accountIds = await this.getVisibleAccountIds(householdId, viewerUserId, view);
    const buckets = this.emptyMonthBuckets(months);
    if (accountIds.length === 0) return buckets;

    const now = new Date();
    const from = new Date(now.getFullYear(), now.getMonth() - (months - 1), 1);

    const rows = await prisma.transaction.findMany({
      where: { accountId: { in: accountIds }, postedDate: { gte: from } },
      select: {
        amountMinor: true,
        postedDate: true,
        hasSplit: true,
        category: { select: { kind: true } },
        splits: { select: { amountMinor: true, category: { select: { kind: true } } } },
      },
    });

    const bucketMap = new Map(buckets.map((b) => [b.month, b]));

    for (const tx of rows) {
      const monthKey = tx.postedDate.toISOString().slice(0, 7);
      const bucket = bucketMap.get(monthKey);
      if (!bucket) continue;

      const agg: TxForAgg = {
        amountMinor: tx.amountMinor,
        postedDate: tx.postedDate,
        hasSplit: tx.hasSplit,
        categoryKind: tx.category?.kind ?? null,
        splits: tx.splits.map((s) => ({ amountMinor: s.amountMinor, categoryKind: s.category?.kind ?? null })),
      };
      for (const { amountMinor, categoryKind } of this.lineItems(agg)) {
        if (categoryKind === 'transfer') continue;
        if (amountMinor > 0) bucket.incomeMinor += amountMinor;
        else bucket.spendingMinor += Math.abs(amountMinor);
      }
    }

    return buckets;
  }

  // ── Shared helpers ────────────────────────────────────────────────────────

  private lineItems(tx: TxForAgg): Array<{ amountMinor: number; categoryKind: string | null }> {
    if (tx.hasSplit) return tx.splits;
    return [{ amountMinor: tx.amountMinor, categoryKind: tx.categoryKind }];
  }

  private emptyMonthBuckets(months: number): SpendingOverTimeItem[] {
    const now = new Date();
    return Array.from({ length: months }, (_, i) => {
      const d = new Date(now.getFullYear(), now.getMonth() - (months - 1 - i), 1);
      return {
        month: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
        spendingMinor: 0,
        incomeMinor: 0,
      };
    });
  }
}
