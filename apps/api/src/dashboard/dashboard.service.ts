import { Injectable } from '@nestjs/common';
import { prisma } from '@pfm/db';
import { buildScope } from '@pfm/core';
import type { DashboardSummary, SpendingByCategoryItem, SpendingOverTimeItem } from '@pfm/contracts';

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

    // Previous calendar month range (UTC-consistent)
    const fromDate = new Date(from);
    const prevMonthStart = new Date(Date.UTC(fromDate.getUTCFullYear(), fromDate.getUTCMonth() - 1, 1));
    const prevMonthEnd = new Date(Date.UTC(fromDate.getUTCFullYear(), fromDate.getUTCMonth(), 0));

    const fetchTx = (start: Date, end: Date) =>
      accountIds.length === 0
        ? Promise.resolve([] as Array<{ amountMinor: number; category: { kind: string } | null }>)
        : prisma.transaction.findMany({
            where: { accountId: { in: accountIds }, postedDate: { gte: start, lte: end }, isExcluded: false },
            select: { amountMinor: true, category: { select: { kind: true } } },
          });

    const [accounts, rows, prevRows] = await Promise.all([
      prisma.account.findMany({
        where: { id: { in: accountIds } },
        select: { balanceMinor: true, currency: true, type: true },
      }),
      fetchTx(new Date(from), new Date(to)),
      fetchTx(prevMonthStart, prevMonthEnd),
    ]);

    function sumIncomeSpending(txRows: Array<{ amountMinor: number; category: { kind: string } | null }>) {
      let income = 0;
      let spending = 0;
      for (const tx of txRows) {
        if (tx.category?.kind === 'transfer') continue;
        if (tx.amountMinor > 0) income += tx.amountMinor;
        else spending += Math.abs(tx.amountMinor);
      }
      return { income, spending };
    }

    const LIABILITY_TYPES = new Set(['credit_card', 'loan', 'mortgage']);
    const netWorthMinor = accounts
      .filter((a) => a.currency === baseCurrency)
      .reduce((sum, a) => sum + (LIABILITY_TYPES.has(a.type) ? -a.balanceMinor : a.balanceMinor), 0);

    const { income: incomeMinor, spending: spendingMinor } = sumIncomeSpending(rows);
    const { income: previousIncomeMinor, spending: previousSpendingMinor } = sumIncomeSpending(prevRows);

    return {
      netWorthMinor,
      currency: baseCurrency,
      incomeMinor,
      spendingMinor,
      previousIncomeMinor,
      previousSpendingMinor,
      from,
      to,
    };
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
      where: {
        accountId: { in: accountIds },
        postedDate: { gte: new Date(from), lte: new Date(to) },
        isExcluded: false,
      },
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
        if (item.amountMinor >= 0) continue;
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
    const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (months - 1), 1));

    // Categories with a sinking fund → amber "annual expense" bar.
    // Categories whose name contains "tax" (case-insensitive) → purple "taxes" bar.
    const [sinkingFunds, taxCategories] = await Promise.all([
      prisma.sinkingFund.findMany({ where: { householdId }, select: { categoryId: true } }),
      prisma.category.findMany({
        where: { householdId, name: { contains: 'tax', mode: 'insensitive' } },
        select: { id: true },
      }),
    ]);
    const reserveCategoryIds = new Set(sinkingFunds.map((f) => f.categoryId));
    const taxCategoryIds = new Set(taxCategories.map((c) => c.id));

    const rows = await prisma.transaction.findMany({
      where: {
        accountId: { in: accountIds },
        postedDate: { gte: from },
        isExcluded: false,
      },
      select: {
        amountMinor: true,
        postedDate: true,
        categoryId: true,
        hasSplit: true,
        category: { select: { kind: true } },
        splits: { select: { amountMinor: true, categoryId: true, category: { select: { kind: true } } } },
      },
    });

    const bucketMap = new Map(buckets.map((b) => [b.month, b]));

    for (const tx of rows) {
      const monthKey = `${tx.postedDate.getUTCFullYear()}-${String(tx.postedDate.getUTCMonth() + 1).padStart(2, '0')}`;
      const bucket = bucketMap.get(monthKey);
      if (!bucket) continue;

      const items = tx.hasSplit
        ? tx.splits.map((s) => ({ amountMinor: s.amountMinor, categoryId: s.categoryId, kind: s.category?.kind ?? null }))
        : [{ amountMinor: tx.amountMinor, categoryId: tx.categoryId, kind: tx.category?.kind ?? null }];

      for (const item of items) {
        if (item.kind === 'transfer') continue;
        if (item.amountMinor > 0) {
          bucket.incomeMinor += item.amountMinor;
        } else if (item.categoryId && taxCategoryIds.has(item.categoryId)) {
          bucket.taxSpendingMinor += Math.abs(item.amountMinor);
        } else if (item.categoryId && reserveCategoryIds.has(item.categoryId)) {
          bucket.reserveSpendingMinor += Math.abs(item.amountMinor);
        } else {
          bucket.spendingMinor += Math.abs(item.amountMinor);
        }
      }
    }

    return buckets;
  }

  private emptyMonthBuckets(months: number): SpendingOverTimeItem[] {
    const now = new Date();
    return Array.from({ length: months }, (_, i) => {
      const offsetMonth = now.getUTCMonth() - (months - 1 - i);
      const d = new Date(Date.UTC(now.getUTCFullYear(), offsetMonth, 1));
      return {
        month: `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`,
        spendingMinor: 0,
        reserveSpendingMinor: 0,
        taxSpendingMinor: 0,
        incomeMinor: 0,
      };
    });
  }
}
