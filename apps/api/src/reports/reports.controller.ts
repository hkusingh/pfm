import { Body, Controller, Delete, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { ok } from '../common/response';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ReportsService } from './reports.service';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { CreateSavedChartBodySchema } from '@pfm/contracts';
import type { AccessTokenPayload } from '@pfm/contracts';

type View = 'household' | 'personal';

function parseView(raw?: string): View {
  return raw === 'personal' ? 'personal' : 'household';
}

function parseMonths(raw?: string, fallback = 6, max = 24): number {
  const n = raw ? parseInt(raw, 10) : fallback;
  return isNaN(n) ? fallback : Math.min(max, Math.max(1, n));
}

@Controller('households/:householdId/reports')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get('spending-by-category-over-time')
  async spendingByCategoryOverTime(
    @Param('householdId') householdId: string,
    @CurrentUser() user: AccessTokenPayload,
    @Query('months') months?: string,
    @Query('view') view?: string,
    @Query('accountId') accountId?: string,
    @Query('categoryIds') categoryIds?: string,
  ) {
    const catIds = categoryIds ? categoryIds.split(',').filter(Boolean) : undefined;
    return ok(await this.reports.getSpendingByCategoryOverTime(
      householdId, user.sub, parseView(view), parseMonths(months), accountId, catIds,
    ));
  }

  @Get('period-comparison')
  async periodComparison(
    @Param('householdId') householdId: string,
    @CurrentUser() user: AccessTokenPayload,
    @Query('granularity') granularity: string,
    @Query('period1') period1: string,
    @Query('period2') period2: string,
    @Query('view') view?: string,
  ) {
    const g = (granularity === 'quarter' || granularity === 'year') ? granularity : 'month';
    return ok(await this.reports.getPeriodComparison(
      householdId, user.sub, parseView(view), g, period1, period2,
    ));
  }

  @Get('top-merchants')
  async topMerchants(
    @Param('householdId') householdId: string,
    @CurrentUser() user: AccessTokenPayload,
    @Query('months') months?: string,
    @Query('view') view?: string,
    @Query('limit') limit?: string,
  ) {
    const lim = limit ? Math.min(50, Math.max(1, parseInt(limit, 10))) : 10;
    return ok(await this.reports.getTopMerchants(
      householdId, user.sub, parseView(view), parseMonths(months), lim,
    ));
  }

  @Get('net-worth-trend')
  async netWorthTrend(
    @Param('householdId') householdId: string,
    @CurrentUser() user: AccessTokenPayload,
    @Query('months') months?: string,
  ) {
    return ok(await this.reports.getNetWorthTrend(
      householdId, user.sub, parseMonths(months, 12),
    ));
  }

  // ── Saved charts ─────────────────────────────────────────────────────────

  @Get('saved-charts')
  async listSavedCharts(
    @Param('householdId') householdId: string,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return ok(await this.reports.listSavedCharts(householdId, user.sub));
  }

  @Post('saved-charts')
  async createSavedChart(
    @Param('householdId') householdId: string,
    @CurrentUser() user: AccessTokenPayload,
    @Body(new ZodValidationPipe(CreateSavedChartBodySchema)) body: unknown,
  ) {
    return ok(await this.reports.createSavedChart(
      householdId, user.sub, body as Parameters<typeof this.reports.createSavedChart>[2],
    ));
  }

  @Delete('saved-charts/:chartId')
  @HttpCode(204)
  async deleteSavedChart(
    @Param('householdId') householdId: string,
    @Param('chartId') chartId: string,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    await this.reports.deleteSavedChart(householdId, chartId, user.sub);
  }
}
