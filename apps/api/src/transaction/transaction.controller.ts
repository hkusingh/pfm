import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { ok } from '../common/response';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { TransactionService } from './transaction.service';
import { RecategorizeTxBodySchema } from '@pfm/contracts';
import type { AccessTokenPayload } from '@pfm/contracts';

@Controller('households/:householdId/transactions')
export class TransactionController {
  constructor(private readonly txs: TransactionService) {}

  @Get()
  async list(
    @Param('householdId') householdId: string,
    @CurrentUser() user: AccessTokenPayload,
    @Query('search') search?: string,
    @Query('accountId') accountId?: string,
    @Query('categoryId') categoryId?: string,
    @Query('hasCategory') hasCategory?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return ok(
      await this.txs.listTransactions(householdId, user.sub, {
        search,
        accountId,
        categoryId,
        hasCategory: hasCategory === 'true' ? true : hasCategory === 'false' ? false : undefined,
        from,
        to,
        page: page ? parseInt(page, 10) : undefined,
        limit: limit ? parseInt(limit, 10) : undefined,
      }),
    );
  }

  @Post('apply-rules')
  @HttpCode(200)
  async applyRules(
    @Param('householdId') householdId: string,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return ok(await this.txs.applyRulesToAll(householdId, user.sub));
  }

  @Patch(':txId/category')
  @HttpCode(200)
  async recategorize(
    @Param('householdId') householdId: string,
    @Param('txId') txId: string,
    @CurrentUser() user: AccessTokenPayload,
    @Body(new ZodValidationPipe(RecategorizeTxBodySchema)) body: z.infer<typeof RecategorizeTxBodySchema>,
  ) {
    return ok(await this.txs.recategorize(txId, householdId, user.sub, body));
  }
}
