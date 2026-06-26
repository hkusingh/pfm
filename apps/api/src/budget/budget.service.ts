import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { prisma } from '@pfm/db';
import { buildScope, computeReserveProgress, amortizedMonthlyMinor } from '@pfm/core';
import { EncryptionService } from '../common/encryption.service';
import type {
  BudgetResponse,
  BudgetSummaryItem,
  BudgetSummaryResponse,
  UpsertBudgetBody,
  SinkingFundResponse,
  CreateSinkingFundBody,
  UpdateSinkingFundBody,
  IncomeSummaryResponse,
} from '@pfm/contracts';
import { DEFAULT_BUDGET_PERIOD } from '@pfm/contracts';

const PERIOD_RE = /^\d{4}-\d{2}$/;

function currentPeriod(): string {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
}

// [start, end) date range covering the given YYYY-MM period.
function periodRange(period: string): { start: Date; end: Date } {
  if (!PERIOD_RE.test(period)) throw new BadRequestException('period must be YYYY-MM (not __default__)');
  const [y, m] = period.split('-').map(Number);
  const start = new Date(Date.UTC(y, m - 1, 1));
  const end = new Date(Date.UTC(y, m, 1));
  return { start, end };
}

function budgetToResponse(b: {
  id: string; householdId: string; categoryId: string; period: string;
  amountMinor: number; createdAt: Date; updatedAt: Date;
}): BudgetResponse {
  return {
    id: b.id,
    householdId: b.householdId,
    categoryId: b.categoryId,
    period: b.period,
    amountMinor: b.amountMinor,
    createdAt: b.createdAt.toISOString(),
    updatedAt: b.updatedAt.toISOString(),
  };
}

@Injectable()
export class BudgetService {
  constructor(private readonly encryption: EncryptionService) {}

  // ── Visibility-scoped accounts (mirrors transaction/dashboard services) ───

  private async getVisibleAccountIds(householdId: string, viewerUserId: string): Promise<string[]> {
    const allAccounts = await prisma.account.findMany({
      where: { householdId },
      select: { id: true, ownerUserId: true, visibility: true },
    });
    const scope = buildScope(viewerUserId, householdId, 'household', allAccounts);
    return [...scope.lineItemAccountIds];
  }

  // ── E6.1 / E6.2 — Budget summary (spent vs remaining, sub-category rollups) ──

  async getBudgetSummary(
    householdId: string,
    viewerUserId: string,
    period: string | undefined,
  ): Promise<BudgetSummaryResponse> {
    // '__default__' is used by the manage-budget page to fetch default amounts only.
    // Fall back to current period for transaction date range in that case (no spend needed).
    const resolvedPeriod = period ?? currentPeriod();
    const spendPeriod = resolvedPeriod === DEFAULT_BUDGET_PERIOD ? currentPeriod() : resolvedPeriod;
    const { start, end } = periodRange(spendPeriod);

    const [household, accountIds] = await Promise.all([
      prisma.household.findUniqueOrThrow({ where: { id: householdId }, select: { baseCurrency: true } }),
      this.getVisibleAccountIds(householdId, viewerUserId),
    ]);

    const [categories, periodBudgets, defaultBudgets, sinkingFunds, transactions] = await Promise.all([
      prisma.category.findMany({
        where: { householdId, kind: 'expense' },
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      }),
      // No period-specific overrides when querying the default template itself.
      resolvedPeriod === DEFAULT_BUDGET_PERIOD
        ? Promise.resolve([])
        : prisma.budget.findMany({ where: { householdId, period: resolvedPeriod } }),
      prisma.budget.findMany({ where: { householdId, period: DEFAULT_BUDGET_PERIOD } }),
      prisma.sinkingFund.findMany({ where: { householdId } }),
      accountIds.length > 0
        ? prisma.transaction.findMany({
            where: { accountId: { in: accountIds }, postedDate: { gte: start, lt: end } },
            select: {
              amountMinor: true,
              categoryId: true,
              hasSplit: true,
              isReserveFunded: true,
              category: { select: { kind: true } },
              splits: { select: { amountMinor: true, categoryId: true, category: { select: { kind: true } } } },
            },
          })
        : Promise.resolve([]),
    ]);

    // Spent per category — only non-reserve-funded expense line items (B-5: budgets show
    // the amortized set-aside; reserve-funded payments draw from the reserve, not the budget).
    const spentByCategory = new Map<string, number>();
    for (const tx of transactions) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const txAmt = parseInt(this.encryption.decrypt((tx as any).amountMinor, householdId), 10);

      const items = tx.hasSplit
        ? tx.splits.map((s) => ({ amountMinor: s.amountMinor, categoryId: s.categoryId, kind: s.category?.kind ?? null }))
        : [{ amountMinor: txAmt, categoryId: tx.categoryId, kind: tx.category?.kind ?? null }];

      for (const item of items) {
        if (item.kind !== 'expense' || !item.categoryId) continue;
        if (tx.isReserveFunded) continue;
        spentByCategory.set(item.categoryId, (spentByCategory.get(item.categoryId) ?? 0) - item.amountMinor);
      }
    }

    // Monthly set-aside per category, summed across amortized sinking funds for that category.
    const sinkingFundByCategory = new Map<string, number>();
    for (const fund of sinkingFunds) {
      const monthly = amortizedMonthlyMinor(fund.totalMinor, fund.cadence, fund.method);
      sinkingFundByCategory.set(fund.categoryId, (sinkingFundByCategory.get(fund.categoryId) ?? 0) + monthly);
    }

    // Period-specific overrides take precedence over the default template.
    const overrideByCategory = new Map(periodBudgets.map((b) => [b.categoryId, b]));
    const defaultByCategory = new Map(defaultBudgets.map((b) => [b.categoryId, b]));

    const childrenByParent = new Map<string, typeof categories>();
    for (const c of categories) {
      if (!c.parentId) continue;
      const list = childrenByParent.get(c.parentId) ?? [];
      list.push(c);
      childrenByParent.set(c.parentId, list);
    }

    const buildItem = (cat: (typeof categories)[number]): BudgetSummaryItem => {
      const overrideBudget = overrideByCategory.get(cat.id);
      const defaultBudget = defaultByCategory.get(cat.id);
      const effectiveBudget = overrideBudget ?? defaultBudget;

      const sinkingFundMinor = sinkingFundByCategory.get(cat.id) ?? 0;
      const ownSpent = spentByCategory.get(cat.id) ?? 0;

      // Return all children so the UI can show every subcategory for budgeting.
      const children = (childrenByParent.get(cat.id) ?? []).map(buildItem);

      const ownBudgetMinor = (effectiveBudget?.amountMinor ?? 0) + sinkingFundMinor;
      const budgetMinor = ownBudgetMinor + children.reduce((s, c) => s + c.budgetMinor, 0);
      const spentMinor = ownSpent + children.reduce((s, c) => s + c.spentMinor, 0);

      return {
        categoryId: cat.id,
        categoryName: cat.name,
        categoryColor: cat.color,
        parentId: cat.parentId,
        kind: cat.kind as 'expense' | 'income' | 'transfer',
        budgetId: overrideBudget?.id ?? null,
        defaultBudgetId: defaultBudget?.id ?? null,
        defaultBudgetAmountMinor: defaultBudget?.amountMinor ?? 0,
        hasMonthOverride: overrideBudget != null,
        budgetMinor,
        sinkingFundMinor,
        spentMinor,
        remainingMinor: budgetMinor - spentMinor,
        children,
      };
    };

    // Return all top-level expense categories so users can set budgets on any of them.
    // The UI sorts active ones first and paginates; inactive children are still filtered.
    const items = categories.filter((c) => !c.parentId).map(buildItem);

    return { period: resolvedPeriod, currency: household.baseCurrency, items };
  }

  // ── E6.1 — Upsert / delete a category budget for a period ──────────────────

  async upsertBudget(householdId: string, body: UpsertBudgetBody): Promise<BudgetResponse> {
    const category = await prisma.category.findUnique({ where: { id: body.categoryId } });
    if (!category || category.householdId !== householdId) {
      throw new NotFoundException('Category not found');
    }

    const budget = await prisma.budget.upsert({
      where: { householdId_categoryId_period: { householdId, categoryId: body.categoryId, period: body.period } },
      create: { householdId, categoryId: body.categoryId, period: body.period, amountMinor: body.amountMinor },
      update: { amountMinor: body.amountMinor },
    });
    return budgetToResponse(budget);
  }

  async deleteBudget(id: string, householdId: string): Promise<void> {
    const budget = await prisma.budget.findUnique({ where: { id } });
    if (!budget || budget.householdId !== householdId) throw new NotFoundException('Budget not found');
    await prisma.budget.delete({ where: { id } });
  }

  // ── E6.3 — Sinking funds (virtual reserves) ─────────────────────────────────

  private toSinkingFundResponse(fund: {
    id: string; householdId: string; categoryId: string; cadence: string; totalMinor: number;
    nextDueDate: Date; method: string; startMode: string; reserveBalanceMinor: number;
    createdAt: Date; updatedAt: Date; category: { name: string };
  }): SinkingFundResponse {
    const progress = computeReserveProgress({
      totalMinor: fund.totalMinor,
      cadence: fund.cadence as 'annual' | 'semi' | 'quarterly',
      method: fund.method as 'amortized' | 'actual',
      nextDueDate: fund.nextDueDate.toISOString().slice(0, 10),
      startMode: fund.startMode as 'gradual' | 'frontload',
      createdAt: fund.createdAt.toISOString().slice(0, 10),
      reserveBalanceMinor: fund.reserveBalanceMinor,
    });

    return {
      id: fund.id,
      householdId: fund.householdId,
      categoryId: fund.categoryId,
      categoryName: fund.category.name,
      cadence: fund.cadence as 'annual' | 'semi' | 'quarterly',
      totalMinor: fund.totalMinor,
      nextDueDate: fund.nextDueDate.toISOString().slice(0, 10),
      method: fund.method as 'amortized' | 'actual',
      startMode: fund.startMode as 'gradual' | 'frontload',
      reserveBalanceMinor: progress.reserveBalanceMinor,
      monthlyAmountMinor: progress.monthlyAmountMinor,
      targetByNowMinor: progress.targetByNowMinor,
      deltaMinor: progress.deltaMinor,
      shortfallMinor: progress.shortfallMinor,
      status: progress.status,
      createdAt: fund.createdAt.toISOString(),
      updatedAt: fund.updatedAt.toISOString(),
    };
  }

  async listSinkingFunds(householdId: string): Promise<SinkingFundResponse[]> {
    const funds = await prisma.sinkingFund.findMany({
      where: { householdId },
      include: { category: { select: { name: true } } },
      orderBy: { nextDueDate: 'asc' },
    });
    return funds.map((f) => this.toSinkingFundResponse(f));
  }

  async createSinkingFund(householdId: string, body: CreateSinkingFundBody): Promise<SinkingFundResponse> {
    const category = await prisma.category.findUnique({ where: { id: body.categoryId } });
    if (!category || category.householdId !== householdId) {
      throw new NotFoundException('Category not found');
    }

    const fund = await prisma.sinkingFund.create({
      data: {
        householdId,
        categoryId: body.categoryId,
        cadence: body.cadence,
        totalMinor: body.totalMinor,
        nextDueDate: new Date(body.nextDueDate),
        method: body.method ?? 'amortized',
        startMode: body.startMode ?? 'gradual',
      },
      include: { category: { select: { name: true } } },
    });
    return this.toSinkingFundResponse(fund);
  }

  async updateSinkingFund(id: string, householdId: string, body: UpdateSinkingFundBody): Promise<SinkingFundResponse> {
    const fund = await prisma.sinkingFund.findUnique({ where: { id } });
    if (!fund || fund.householdId !== householdId) throw new NotFoundException('Sinking fund not found');

    const updated = await prisma.sinkingFund.update({
      where: { id },
      data: {
        ...(body.cadence !== undefined ? { cadence: body.cadence } : {}),
        ...(body.totalMinor !== undefined ? { totalMinor: body.totalMinor } : {}),
        ...(body.nextDueDate !== undefined ? { nextDueDate: new Date(body.nextDueDate) } : {}),
        ...(body.method !== undefined ? { method: body.method } : {}),
        ...(body.startMode !== undefined ? { startMode: body.startMode } : {}),
        ...(body.reserveBalanceMinor !== undefined ? { reserveBalanceMinor: body.reserveBalanceMinor } : {}),
      },
      include: { category: { select: { name: true } } },
    });
    return this.toSinkingFundResponse(updated);
  }

  async deleteSinkingFund(id: string, householdId: string): Promise<void> {
    const fund = await prisma.sinkingFund.findUnique({ where: { id } });
    if (!fund || fund.householdId !== householdId) throw new NotFoundException('Sinking fund not found');
    await prisma.sinkingFund.delete({ where: { id } });
  }

  // ── E6.4 — Income tracking (received vs expected; not a spend cap) ─────────

  async getIncomeSummary(
    householdId: string,
    viewerUserId: string,
    period: string | undefined,
  ): Promise<IncomeSummaryResponse> {
    const resolvedPeriod = period ?? currentPeriod();
    const { start, end } = periodRange(resolvedPeriod);

    const [household, accountIds] = await Promise.all([
      prisma.household.findUniqueOrThrow({ where: { id: householdId }, select: { baseCurrency: true } }),
      this.getVisibleAccountIds(householdId, viewerUserId),
    ]);

    const [categories, budgets, transactions] = await Promise.all([
      prisma.category.findMany({
        where: { householdId, kind: 'income' },
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      }),
      prisma.budget.findMany({ where: { householdId, period: resolvedPeriod } }),
      accountIds.length > 0
        ? prisma.transaction.findMany({
            where: { accountId: { in: accountIds }, postedDate: { gte: start, lt: end } },
            select: {
              amountMinor: true,
              categoryId: true,
              hasSplit: true,
              category: { select: { kind: true } },
              splits: { select: { amountMinor: true, categoryId: true, category: { select: { kind: true } } } },
            },
          })
        : Promise.resolve([]),
    ]);

    const receivedByCategory = new Map<string, number>();
    for (const tx of transactions) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const txAmt = parseInt(this.encryption.decrypt((tx as any).amountMinor, householdId), 10);

      const items = tx.hasSplit
        ? tx.splits.map((s) => ({ amountMinor: s.amountMinor, categoryId: s.categoryId, kind: s.category?.kind ?? null }))
        : [{ amountMinor: txAmt, categoryId: tx.categoryId, kind: tx.category?.kind ?? null }];

      for (const item of items) {
        if (item.kind !== 'income' || !item.categoryId || item.amountMinor <= 0) continue;
        receivedByCategory.set(item.categoryId, (receivedByCategory.get(item.categoryId) ?? 0) + item.amountMinor);
      }
    }

    const budgetByCategory = new Map(budgets.map((b) => [b.categoryId, b.amountMinor]));

    // Only include income categories where income has actually been received this period.
    const items = categories
      .map((cat) => ({
        categoryId: cat.id,
        categoryName: cat.name,
        categoryColor: cat.color,
        expectedMinor: budgetByCategory.get(cat.id) ?? 0,
        receivedMinor: receivedByCategory.get(cat.id) ?? 0,
      }))
      .filter((i) => i.receivedMinor > 0);

    return { period: resolvedPeriod, currency: household.baseCurrency, items };
  }
}
