import { Injectable, ForbiddenException, NotFoundException } from '@nestjs/common';
import { prisma } from '@pfm/db';
import { buildScope } from '@pfm/core';
import type {
  SpendingByCategoryOverTimeResponse,
  PeriodComparisonResponse,
  TopMerchantsResponse,
  NetWorthTrendResponse,
  SavedChartResponse,
  SavedChartsListResponse,
  CreateSavedChartBody,
  ChartType,
  ChartMeasure,
  ChartGroupBy,
  ChartDateRange,
  ChartView,
  ReportKey,
} from '@pfm/contracts';
import { EncryptionService } from '../common/encryption.service';

type CatMeta = { name: string; color: string | null; parentId: string | null };

@Injectable()
export class ReportsService {
  constructor(private readonly encryption: EncryptionService) {}

  private decAmt(enc: string, householdId: string): number {
    return parseInt(this.encryption.decrypt(enc, householdId), 10);
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private async getVisibleAccountIds(
    householdId: string,
    viewerUserId: string,
    view: 'household' | 'personal',
    filterAccountId?: string,
  ): Promise<string[]> {
    const allAccounts = await prisma.account.findMany({
      where: { householdId },
      select: { id: true, ownerUserId: true, visibility: true },
    });
    const scope = buildScope(viewerUserId, householdId, 'household', allAccounts);
    let ids = [...scope.lineItemAccountIds];
    if (view === 'personal') {
      const owned = new Set(allAccounts.filter((a) => a.ownerUserId === viewerUserId).map((a) => a.id));
      ids = ids.filter((id) => owned.has(id));
    }
    if (filterAccountId) {
      ids = ids.filter((id) => id === filterAccountId);
    }
    return ids;
  }

  private monthsBack(n: number): { start: Date; months: string[] } {
    const now = new Date();
    const months: string[] = [];
    for (let i = n - 1; i >= 0; i--) {
      const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
      months.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`);
    }
    const start = new Date(`${months[0]}-01`);
    return { start, months };
  }

  private async getCategoryMap(householdId: string): Promise<Map<string, CatMeta>> {
    const cats = await prisma.category.findMany({
      where: { householdId },
      select: { id: true, name: true, color: true, parentId: true },
    });
    return new Map(cats.map((c) => [c.id, { name: c.name, color: c.color, parentId: c.parentId }]));
  }

  private getTopLevelId(catId: string, catMap: Map<string, CatMeta>): string {
    const cat = catMap.get(catId);
    if (!cat || cat.parentId === null) return catId;
    return cat.parentId;
  }

  // ── Spending by category over time ────────────────────────────────────────

  async getSpendingByCategoryOverTime(
    householdId: string,
    viewerUserId: string,
    view: 'household' | 'personal',
    months: number,
    accountId?: string,
    categoryIds?: string[],
  ): Promise<SpendingByCategoryOverTimeResponse> {
    const { start, months: monthKeys } = this.monthsBack(months);
    const accountIds = await this.getVisibleAccountIds(householdId, viewerUserId, view, accountId);
    if (accountIds.length === 0) {
      return { months: monthKeys, categories: [] };
    }

    const catMap = await this.getCategoryMap(householdId);

    // amountMinor filter removed from SQL — decrypt and filter < 0 in JS
    const rows = await prisma.transaction.findMany({
      where: {
        accountId: { in: accountIds },
        postedDate: { gte: start },
        isExcluded: false,
        hasSplit: false,
        categoryId: { not: null },
      },
      select: { postedDate: true, amountMinor: true, categoryId: true },
    }) as unknown as Array<{ postedDate: Date; amountMinor: string; categoryId: string | null }>;

    // Split amounts stay as Int (not encrypted)
    const splitRows = await prisma.transactionSplit.findMany({
      where: {
        transaction: { accountId: { in: accountIds }, postedDate: { gte: start }, isExcluded: false, hasSplit: true },
        categoryId: { not: null },
        amountMinor: { lt: 0 },
      },
      select: {
        amountMinor: true,
        categoryId: true,
        transaction: { select: { postedDate: true } },
      },
    });

    const accumMap = new Map<string, { name: string; color: string | null; byMonth: Map<string, number> }>();

    const accum = (catId: string, monthKey: string, abs: number) => {
      const topId = this.getTopLevelId(catId, catMap);
      const topCat = catMap.get(topId);
      if (!topCat || topCat.name === 'Transfer') return;
      if (!accumMap.has(topId)) accumMap.set(topId, { name: topCat.name, color: topCat.color, byMonth: new Map() });
      const entry = accumMap.get(topId)!;
      entry.byMonth.set(monthKey, (entry.byMonth.get(monthKey) ?? 0) + abs);
    };

    for (const row of rows) {
      const amt = this.decAmt(row.amountMinor, householdId);
      if (amt >= 0) continue; // only expenses
      const mk = (row.postedDate as Date).toISOString().slice(0, 7);
      if (!monthKeys.includes(mk)) continue;
      accum(row.categoryId!, mk, Math.abs(amt));
    }

    for (const split of splitRows) {
      const mk = (split.transaction.postedDate as Date).toISOString().slice(0, 7);
      if (!monthKeys.includes(mk)) continue;
      accum(split.categoryId!, mk, Math.abs(split.amountMinor));
    }

    if (categoryIds && categoryIds.length > 0) {
      const pinnedSet = new Set(categoryIds);
      const pinned = categoryIds
        .filter((id) => accumMap.has(id))
        .map((id) => {
          const e = accumMap.get(id)!;
          return { categoryId: id, name: e.name, color: e.color, amounts: monthKeys.map((mk) => e.byMonth.get(mk) ?? 0) };
        });

      const otherAmounts = monthKeys.map((_, mi) =>
        [...accumMap.entries()]
          .filter(([id]) => !pinnedSet.has(id))
          .reduce((s, [, e]) => s + (e.byMonth.get(monthKeys[mi]) ?? 0), 0),
      );
      const hasOther = otherAmounts.some((v) => v > 0);

      return {
        months: monthKeys,
        categories: [
          ...pinned,
          ...(hasOther ? [{ categoryId: '__other__', name: 'Other', color: '#9CA3AF', amounts: otherAmounts }] : []),
        ],
      };
    }

    const sorted = [...accumMap.entries()]
      .map(([categoryId, { name, color, byMonth }]) => ({
        categoryId,
        name,
        color,
        amounts: monthKeys.map((mk) => byMonth.get(mk) ?? 0),
        total: [...byMonth.values()].reduce((s, v) => s + v, 0),
      }))
      .sort((a, b) => b.total - a.total);

    const top = sorted.slice(0, 4);
    const rest = sorted.slice(4);

    if (rest.length > 0) {
      top.push({
        categoryId: '__other__',
        name: 'Other',
        color: '#9CA3AF',
        amounts: monthKeys.map((_, mi) => rest.reduce((s, c) => s + (c.amounts[mi] ?? 0), 0)),
        total: rest.reduce((s, c) => s + c.total, 0),
      });
    }

    return { months: monthKeys, categories: top.map(({ total: _total, ...r }) => r) };
  }

  // ── Period comparison ──────────────────────────────────────────────────────

  private parsePeriodRange(granularity: string, period: string): { from: Date; to: Date; label: string } {
    if (granularity === 'month') {
      const [y, m] = period.split('-').map(Number);
      const from = new Date(Date.UTC(y, m - 1, 1));
      const to = new Date(Date.UTC(y, m, 0));
      const label = from.toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
      return { from, to, label };
    }
    if (granularity === 'quarter') {
      const [y, q] = [parseInt(period.slice(0, 4)), parseInt(period.slice(6))];
      const startMonth = (q - 1) * 3;
      const from = new Date(Date.UTC(y, startMonth, 1));
      const to = new Date(Date.UTC(y, startMonth + 3, 0));
      return { from, to, label: `Q${q} ${y}` };
    }
    const y = parseInt(period);
    return { from: new Date(Date.UTC(y, 0, 1)), to: new Date(Date.UTC(y, 11, 31)), label: String(y) };
  }

  private async spendByCategoryInRange(
    accountIds: string[],
    from: Date,
    to: Date,
    householdId: string,
  ): Promise<Map<string, { name: string; amountMinor: number; parentId: string | null }>> {
    if (accountIds.length === 0) return new Map();

    // amountMinor filter removed from SQL — decrypt and filter < 0 in JS
    const rows = await prisma.transaction.findMany({
      where: {
        accountId: { in: accountIds },
        postedDate: { gte: from, lte: to },
        isExcluded: false,
        hasSplit: false,
        categoryId: { not: null },
      },
      select: {
        amountMinor: true,
        categoryId: true,
        category: { select: { name: true, parentId: true } },
      },
    }) as unknown as Array<{
      amountMinor: string;
      categoryId: string | null;
      category: { name: string; parentId: string | null } | null;
    }>;

    const result = new Map<string, { name: string; amountMinor: number; parentId: string | null }>();
    for (const row of rows) {
      const amt = this.decAmt(row.amountMinor, householdId);
      if (amt >= 0) continue; // only expenses
      const id = row.categoryId!;
      const existing = result.get(id);
      if (existing) {
        existing.amountMinor += Math.abs(amt);
      } else {
        result.set(id, { name: row.category!.name, amountMinor: Math.abs(amt), parentId: row.category!.parentId });
      }
    }
    return result;
  }

  async getPeriodComparison(
    householdId: string,
    viewerUserId: string,
    view: 'household' | 'personal',
    granularity: 'month' | 'quarter' | 'year',
    period1: string,
    period2: string,
  ): Promise<PeriodComparisonResponse> {
    const p1 = this.parsePeriodRange(granularity, period1);
    const p2 = this.parsePeriodRange(granularity, period2);
    const accountIds = await this.getVisibleAccountIds(householdId, viewerUserId, view);
    const catMap = await this.getCategoryMap(householdId);

    const [map1, map2] = await Promise.all([
      this.spendByCategoryInRange(accountIds, p1.from, p1.to, householdId),
      this.spendByCategoryInRange(accountIds, p2.from, p2.to, householdId),
    ]);

    type ParentEntry = {
      name: string;
      period1Minor: number;
      period2Minor: number;
      subs: Map<string, { name: string; period1Minor: number; period2Minor: number }>;
    };

    const parents = new Map<string, ParentEntry>();

    const ensureParent = (parentId: string, name: string) => {
      if (!parents.has(parentId)) {
        parents.set(parentId, { name, period1Minor: 0, period2Minor: 0, subs: new Map() });
      }
      return parents.get(parentId)!;
    };

    for (const catId of new Set([...map1.keys(), ...map2.keys()])) {
      const entry = map1.get(catId) ?? map2.get(catId)!;
      const p1Minor = map1.get(catId)?.amountMinor ?? 0;
      const p2Minor = map2.get(catId)?.amountMinor ?? 0;

      const isTopLevel = entry.parentId === null;
      const parentId = entry.parentId ?? catId;
      const parentName = catMap.get(parentId)?.name ?? entry.name;

      const parent = ensureParent(parentId, parentName);
      parent.period1Minor += p1Minor;
      parent.period2Minor += p2Minor;

      if (!isTopLevel) {
        const existingSub = parent.subs.get(catId);
        if (existingSub) {
          existingSub.period1Minor += p1Minor;
          existingSub.period2Minor += p2Minor;
        } else {
          parent.subs.set(catId, { name: entry.name, period1Minor: p1Minor, period2Minor: p2Minor });
        }
      }
    }

    const toRow = (id: string, name: string, p1: number, p2: number) => {
      const delta = p2 - p1;
      const pct = p1 === 0 ? null : Math.round((delta / p1) * 100);
      return { categoryId: id, categoryName: name, period1Minor: p1, period2Minor: p2, deltaMinor: delta, deltaPct: pct };
    };

    const rows = [...parents.entries()]
      .filter(([, { name }]) => name !== 'Transfer')
      .map(([parentId, { name, period1Minor, period2Minor, subs }]) => ({
        ...toRow(parentId, name, period1Minor, period2Minor),
        subRows: [...subs.entries()]
          .map(([subId, sub]) => toRow(subId, sub.name, sub.period1Minor, sub.period2Minor))
          .sort((a, b) => b.period2Minor - a.period2Minor),
      }))
      .sort((a, b) => b.period2Minor - a.period2Minor);

    const totalPeriod1Minor = rows.reduce((s, r) => s + r.period1Minor, 0);
    const totalPeriod2Minor = rows.reduce((s, r) => s + r.period2Minor, 0);

    return { period1Label: p1.label, period2Label: p2.label, rows, totalPeriod1Minor, totalPeriod2Minor };
  }

  // ── Top merchants ──────────────────────────────────────────────────────────

  async getTopMerchants(
    householdId: string,
    viewerUserId: string,
    view: 'household' | 'personal',
    months: number,
    limit: number,
  ): Promise<TopMerchantsResponse> {
    const { start } = this.monthsBack(months);
    const accountIds = await this.getVisibleAccountIds(householdId, viewerUserId, view);
    if (accountIds.length === 0) return { merchants: [] };

    // amountMinor filter removed from SQL (encrypted); merchantNormalized can't be grouped in SQL
    const rows = await prisma.transaction.findMany({
      where: {
        accountId: { in: accountIds },
        postedDate: { gte: start },
        isExcluded: false,
        merchantNormalized: { not: null },
      },
      select: { merchantNormalized: true, amountMinor: true },
    }) as unknown as Array<{ merchantNormalized: string; amountMinor: string }>;

    const map = new Map<string, { amountMinor: number; count: number }>();
    for (const row of rows) {
      const amt = this.decAmt(row.amountMinor, householdId);
      if (amt >= 0) continue; // only expenses
      const key = this.encryption.decrypt(row.merchantNormalized, householdId);
      const existing = map.get(key);
      if (existing) {
        existing.amountMinor += Math.abs(amt);
        existing.count += 1;
      } else {
        map.set(key, { amountMinor: Math.abs(amt), count: 1 });
      }
    }

    const merchants = [...map.entries()]
      .map(([name, { amountMinor, count }]) => ({ name, amountMinor, count }))
      .sort((a, b) => b.amountMinor - a.amountMinor)
      .slice(0, limit);

    return { merchants };
  }

  // ── Net worth trend ────────────────────────────────────────────────────────

  async getNetWorthTrend(
    householdId: string,
    viewerUserId: string,
    months: number,
  ): Promise<NetWorthTrendResponse> {
    const { months: monthKeys } = this.monthsBack(months);

    const household = await prisma.household.findUniqueOrThrow({
      where: { id: householdId },
      select: { baseCurrency: true },
    });

    const allAccountsRaw = await prisma.account.findMany({
      where: { householdId },
      select: { id: true, ownerUserId: true, visibility: true, balanceMinor: true, balanceAsOf: true, type: true, currency: true },
    });

    const scope = buildScope(viewerUserId, householdId, 'household', allAccountsRaw);
    const accountIdSet = scope.lineItemAccountIds;
    if (accountIdSet.size === 0) {
      return { points: monthKeys.map((month) => ({ month, netWorthMinor: 0 })) };
    }

    const LIABILITY_TYPES = new Set(['credit_card', 'loan', 'mortgage']);

    const visibleAccounts = allAccountsRaw.filter(
      (a) => accountIdSet.has(a.id) && a.currency === household.baseCurrency,
    );
    const filteredAccountIds = visibleAccounts.map((a) => a.id);

    const lastMonth = monthKeys[monthKeys.length - 1];
    const [y, m] = lastMonth.split('-').map(Number);
    const endOfLastMonth = new Date(Date.UTC(y, m, 0));

    const txRows = await prisma.transaction.findMany({
      where: { accountId: { in: filteredAccountIds }, postedDate: { lte: endOfLastMonth }, isExcluded: false },
      select: { accountId: true, amountMinor: true, postedDate: true },
    }) as unknown as Array<{ accountId: string; amountMinor: string; postedDate: Date }>;

    const currentBalanceByAccount = new Map(
      visibleAccounts.map((a) => {
        const bal = this.decAmt(a.balanceMinor, householdId);
        return [a.id, LIABILITY_TYPES.has(a.type) ? -bal : bal];
      }),
    );

    const txByAccount = new Map<string, { amountMinor: number; postedDate: Date }[]>();
    for (const tx of txRows) {
      const list = txByAccount.get(tx.accountId) ?? [];
      list.push({ amountMinor: this.decAmt(tx.amountMinor, householdId), postedDate: tx.postedDate });
      txByAccount.set(tx.accountId, list);
    }

    const points = monthKeys.map((monthKey) => {
      const [my, mm] = monthKey.split('-').map(Number);
      const endOfMonth = new Date(Date.UTC(my, mm, 0));

      let netWorthMinor = 0;
      for (const account of visibleAccounts) {
        const current = currentBalanceByAccount.get(account.id) ?? 0;
        const sign = LIABILITY_TYPES.has(account.type) ? -1 : 1;
        const futureSum = (txByAccount.get(account.id) ?? [])
          .filter((tx) => tx.postedDate > endOfMonth)
          .reduce((s, tx) => s + tx.amountMinor * sign, 0);
        netWorthMinor += current - futureSum;
      }
      return { month: monthKey, netWorthMinor };
    });

    return { points };
  }

  // ── Saved charts CRUD ─────────────────────────────────────────────────────

  private toResponse(chart: {
    id: string; householdId: string; creatorId: string; name: string;
    chartType: string; measure: string; groupBy: string; dateRange: string;
    reportKey: string | null; view: string; accountId: string | null; categoryId: string | null;
    isShared: boolean; sortOrder: number; createdAt: Date;
  }): SavedChartResponse {
    return {
      ...chart,
      chartType: chart.chartType as ChartType,
      measure: chart.measure as ChartMeasure,
      groupBy: chart.groupBy as ChartGroupBy,
      dateRange: chart.dateRange as ChartDateRange,
      view: chart.view as ChartView,
      reportKey: (chart.reportKey as ReportKey | null) ?? null,
      createdAt: chart.createdAt.toISOString(),
    };
  }

  async listSavedCharts(householdId: string, viewerUserId: string): Promise<SavedChartsListResponse> {
    const charts = await prisma.savedChart.findMany({
      where: { householdId, OR: [{ isShared: true }, { creatorId: viewerUserId }] },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
    return { charts: charts.map((c) => this.toResponse(c)) };
  }

  async createSavedChart(householdId: string, creatorId: string, body: CreateSavedChartBody): Promise<SavedChartResponse> {
    const chart = await prisma.savedChart.create({
      data: {
        householdId,
        creatorId,
        name: body.name,
        chartType: body.chartType,
        measure: body.measure,
        groupBy: body.groupBy,
        dateRange: body.dateRange,
        view: body.view,
        reportKey: body.reportKey ?? null,
        accountId: body.accountId ?? null,
        categoryId: body.categoryId ?? null,
        isShared: body.isShared,
      },
    });
    return this.toResponse(chart);
  }

  async deleteSavedChart(householdId: string, chartId: string, userId: string): Promise<void> {
    const chart = await prisma.savedChart.findUnique({ where: { id: chartId } });
    if (!chart || chart.householdId !== householdId) throw new NotFoundException('Chart not found');

    const membership = await prisma.membership.findUnique({
      where: { householdId_userId: { householdId, userId } },
    });
    const isOwner = membership?.role === 'owner';
    if (chart.creatorId !== userId && !isOwner) {
      throw new ForbiddenException('You do not have permission to delete this chart');
    }

    await prisma.savedChart.delete({ where: { id: chartId } });
  }
}
