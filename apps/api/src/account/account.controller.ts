import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import {
  CreateAccountBodySchema,
  UpdateAccountBodySchema,
  UpdateVisibilityBodySchema,
  CreateTransactionBodySchema,
  UpdateTransactionBodySchema,
} from '@pfm/contracts';
import { ok } from '../common/response';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AccessTokenPayload } from '@pfm/contracts';
import { AccountService } from './account.service';

@Controller()
export class AccountController {
  constructor(private readonly service: AccountService) {}

  // ─── E2.1 / E2.2 — Account CRUD ─────────────────────────────────────────────

  @Post('households/:householdId/accounts')
  async createAccount(
    @CurrentUser() user: AccessTokenPayload,
    @Param('householdId') householdId: string,
    @Body(new ZodValidationPipe(CreateAccountBodySchema)) body: unknown,
  ) {
    const result = await this.service.createAccount(
      householdId,
      user.sub,
      body as Parameters<typeof this.service.createAccount>[2],
    );
    return ok(result);
  }

  @Get('households/:householdId/accounts')
  async listAccounts(
    @CurrentUser() user: AccessTokenPayload,
    @Param('householdId') householdId: string,
  ) {
    const result = await this.service.listAccounts(householdId, user.sub);
    return ok(result);
  }

  @Get('households/:householdId/accounts/:accountId')
  async getAccount(
    @CurrentUser() user: AccessTokenPayload,
    @Param('householdId') householdId: string,
    @Param('accountId') accountId: string,
  ) {
    const result = await this.service.getAccount(accountId, householdId, user.sub);
    return ok(result);
  }

  @Patch('households/:householdId/accounts/:accountId')
  async updateAccount(
    @CurrentUser() user: AccessTokenPayload,
    @Param('householdId') householdId: string,
    @Param('accountId') accountId: string,
    @Body(new ZodValidationPipe(UpdateAccountBodySchema)) body: unknown,
  ) {
    const result = await this.service.updateAccount(
      accountId,
      householdId,
      user.sub,
      body as Parameters<typeof this.service.updateAccount>[3],
    );
    return ok(result);
  }

  // ─── E2.3 — Visibility ──────────────────────────────────────────────────────

  @Patch('households/:householdId/accounts/:accountId/visibility')
  async updateVisibility(
    @CurrentUser() user: AccessTokenPayload,
    @Param('householdId') householdId: string,
    @Param('accountId') accountId: string,
    @Body(new ZodValidationPipe(UpdateVisibilityBodySchema)) body: unknown,
  ) {
    const result = await this.service.updateVisibility(
      accountId,
      householdId,
      user.sub,
      body as Parameters<typeof this.service.updateVisibility>[3],
    );
    return ok(result);
  }

  @Delete('households/:householdId/accounts/:accountId')
  @HttpCode(200)
  async deleteAccount(
    @CurrentUser() user: AccessTokenPayload,
    @Param('householdId') householdId: string,
    @Param('accountId') accountId: string,
  ) {
    await this.service.deleteAccount(accountId, householdId, user.sub);
    return ok({ deleted: true });
  }

  // ─── E2.2 — Manual transactions ─────────────────────────────────────────────

  @Post('households/:householdId/accounts/:accountId/transactions')
  async createTransaction(
    @CurrentUser() user: AccessTokenPayload,
    @Param('householdId') householdId: string,
    @Param('accountId') accountId: string,
    @Body(new ZodValidationPipe(CreateTransactionBodySchema)) body: unknown,
  ) {
    const result = await this.service.createTransaction(
      accountId,
      householdId,
      user.sub,
      body as Parameters<typeof this.service.createTransaction>[3],
    );
    return ok(result);
  }

  @Get('households/:householdId/accounts/:accountId/transactions')
  async listTransactions(
    @CurrentUser() user: AccessTokenPayload,
    @Param('householdId') householdId: string,
    @Param('accountId') accountId: string,
  ) {
    const result = await this.service.listTransactions(accountId, householdId, user.sub);
    return ok(result);
  }

  @Patch('households/:householdId/accounts/:accountId/transactions/:txId')
  async updateTransaction(
    @CurrentUser() user: AccessTokenPayload,
    @Param('householdId') householdId: string,
    @Param('accountId') accountId: string,
    @Param('txId') txId: string,
    @Body(new ZodValidationPipe(UpdateTransactionBodySchema)) body: unknown,
  ) {
    const result = await this.service.updateTransaction(
      txId,
      accountId,
      householdId,
      user.sub,
      body as Parameters<typeof this.service.updateTransaction>[4],
    );
    return ok(result);
  }

  @Delete('households/:householdId/accounts/:accountId/transactions/:txId')
  @HttpCode(200)
  async deleteTransaction(
    @CurrentUser() user: AccessTokenPayload,
    @Param('householdId') householdId: string,
    @Param('accountId') accountId: string,
    @Param('txId') txId: string,
  ) {
    await this.service.deleteTransaction(txId, accountId, householdId, user.sub);
    return ok({ deleted: true });
  }
}
