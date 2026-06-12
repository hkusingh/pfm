import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { z } from 'zod';
import { ok } from '../common/response';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { BudgetService } from './budget.service';
import {
  UpsertBudgetBodySchema,
  CreateSinkingFundBodySchema,
  UpdateSinkingFundBodySchema,
} from '@pfm/contracts';
import type { AccessTokenPayload } from '@pfm/contracts';

@Controller('households/:householdId')
export class BudgetController {
  constructor(private readonly budgets: BudgetService) {}

  // ── E6.1 / E6.2 — Budget summary ────────────────────────────────────────────

  @Get('budgets')
  async getBudgetSummary(
    @Param('householdId') householdId: string,
    @CurrentUser() user: AccessTokenPayload,
    @Query('period') period?: string,
  ) {
    return ok(await this.budgets.getBudgetSummary(householdId, user.sub, period));
  }

  @Put('budgets')
  async upsertBudget(
    @Param('householdId') householdId: string,
    @Body(new ZodValidationPipe(UpsertBudgetBodySchema)) body: z.infer<typeof UpsertBudgetBodySchema>,
  ) {
    return ok(await this.budgets.upsertBudget(householdId, body));
  }

  @Delete('budgets/:id')
  @HttpCode(200)
  async deleteBudget(@Param('householdId') householdId: string, @Param('id') id: string) {
    await this.budgets.deleteBudget(id, householdId);
    return ok({ deleted: true });
  }

  // ── E6.3 — Sinking funds ─────────────────────────────────────────────────────

  @Get('sinking-funds')
  async listSinkingFunds(@Param('householdId') householdId: string) {
    return ok(await this.budgets.listSinkingFunds(householdId));
  }

  @Post('sinking-funds')
  async createSinkingFund(
    @Param('householdId') householdId: string,
    @Body(new ZodValidationPipe(CreateSinkingFundBodySchema)) body: z.infer<typeof CreateSinkingFundBodySchema>,
  ) {
    return ok(await this.budgets.createSinkingFund(householdId, body));
  }

  @Patch('sinking-funds/:id')
  async updateSinkingFund(
    @Param('householdId') householdId: string,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateSinkingFundBodySchema)) body: z.infer<typeof UpdateSinkingFundBodySchema>,
  ) {
    return ok(await this.budgets.updateSinkingFund(id, householdId, body));
  }

  @Delete('sinking-funds/:id')
  @HttpCode(200)
  async deleteSinkingFund(@Param('householdId') householdId: string, @Param('id') id: string) {
    await this.budgets.deleteSinkingFund(id, householdId);
    return ok({ deleted: true });
  }

  // ── E6.4 — Income summary ────────────────────────────────────────────────────

  @Get('income-summary')
  async getIncomeSummary(
    @Param('householdId') householdId: string,
    @CurrentUser() user: AccessTokenPayload,
    @Query('period') period?: string,
  ) {
    return ok(await this.budgets.getIncomeSummary(householdId, user.sub, period));
  }
}
