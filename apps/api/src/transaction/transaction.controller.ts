import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, HttpStatus, Res } from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import { ok } from '../common/response';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { TransactionService } from './transaction.service';
import { RecategorizeTxBodySchema, PutSplitsBodySchema, ExcludeTransactionBodySchema } from '@pfm/contracts';
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
    @Query('categoryIds') categoryIds?: string,
    @Query('hasCategory') hasCategory?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('sortBy') sortBy?: string,
    @Query('sortDir') sortDir?: string,
  ) {
    return ok(
      await this.txs.listTransactions(householdId, user.sub, {
        search,
        accountId,
        categoryId,
        categoryIds,
        hasCategory: hasCategory === 'true' ? true : hasCategory === 'false' ? false : undefined,
        from,
        to,
        page: page ? parseInt(page, 10) : undefined,
        limit: limit ? parseInt(limit, 10) : undefined,
        sortBy: sortBy === 'amount' ? 'amount' : 'date',
        sortDir: sortDir === 'asc' ? 'asc' : 'desc',
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

  @Get(':txId')
  async getOne(
    @Param('householdId') householdId: string,
    @Param('txId') txId: string,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return ok(await this.txs.getTransaction(txId, householdId, user.sub));
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

  @Patch(':txId/splits')
  @HttpCode(200)
  async setSplits(
    @Param('householdId') householdId: string,
    @Param('txId') txId: string,
    @CurrentUser() user: AccessTokenPayload,
    @Body(new ZodValidationPipe(PutSplitsBodySchema)) body: z.infer<typeof PutSplitsBodySchema>,
  ) {
    return ok(await this.txs.setSplits(txId, householdId, user.sub, body));
  }

  @Delete(':txId/splits')
  @HttpCode(200)
  async clearSplits(
    @Param('householdId') householdId: string,
    @Param('txId') txId: string,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return ok(await this.txs.clearSplits(txId, householdId, user.sub));
  }

  @Patch(':txId/exclude')
  @HttpCode(200)
  async exclude(
    @Param('householdId') householdId: string,
    @Param('txId') txId: string,
    @CurrentUser() user: AccessTokenPayload,
    @Body(new ZodValidationPipe(ExcludeTransactionBodySchema)) body: z.infer<typeof ExcludeTransactionBodySchema>,
  ) {
    return ok(await this.txs.excludeTransaction(txId, householdId, user.sub, body));
  }

  @Delete(':txId')
  async deleteTransaction(
    @Param('householdId') householdId: string,
    @Param('txId') txId: string,
    @CurrentUser() user: AccessTokenPayload,
    @Res() res: Response,
  ) {
    await this.txs.deleteTransaction(txId, householdId, user.sub);
    res.status(HttpStatus.NO_CONTENT).send();
  }
}
