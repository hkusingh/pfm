import { Controller, Get, Param, Query } from '@nestjs/common';
import { ok } from '../common/response';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { DashboardService } from './dashboard.service';
import type { AccessTokenPayload } from '@pfm/contracts';

type ViewParam = 'household' | 'personal';

function parseView(raw?: string): ViewParam {
  return raw === 'personal' ? 'personal' : 'household';
}

function currentMonthRange(): { from: string; to: string } {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, '0');
  const d = String(now.getUTCDate()).padStart(2, '0');
  return { from: `${y}-${m}-01`, to: `${y}-${m}-${d}` };
}

@Controller('households/:householdId/dashboard')
export class DashboardController {
  constructor(private readonly dash: DashboardService) {}

  @Get('summary')
  async summary(
    @Param('householdId') householdId: string,
    @CurrentUser() user: AccessTokenPayload,
    @Query('view') view?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    const range = currentMonthRange();
    return ok(await this.dash.getSummary(
      householdId,
      user.sub,
      parseView(view),
      from ?? range.from,
      to ?? range.to,
    ));
  }

  @Get('spending-by-category')
  async spendingByCategory(
    @Param('householdId') householdId: string,
    @CurrentUser() user: AccessTokenPayload,
    @Query('view') view?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    const range = currentMonthRange();
    return ok(await this.dash.getSpendingByCategory(
      householdId,
      user.sub,
      parseView(view),
      from ?? range.from,
      to ?? range.to,
    ));
  }

  @Get('spending-over-time')
  async spendingOverTime(
    @Param('householdId') householdId: string,
    @CurrentUser() user: AccessTokenPayload,
    @Query('view') view?: string,
    @Query('months') months?: string,
  ) {
    const m = months ? Math.min(12, Math.max(1, parseInt(months, 10))) : 6;
    return ok(await this.dash.getSpendingOverTime(householdId, user.sub, parseView(view), m));
  }
}
