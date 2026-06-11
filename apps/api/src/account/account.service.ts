import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  ConflictException,
} from '@nestjs/common';
import { prisma } from '@pfm/db';
import { buildScope, canViewLineItems } from '@pfm/core';
import { normalizeMerchant, computeDedupHash } from '@pfm/core';
import { CategoryService } from '../category/category.service';
import type {
  CreateAccountBody,
  UpdateAccountBody,
  UpdateVisibilityBody,
  AccountResponse,
  AccountListResponse,
  CreateTransactionBody,
  UpdateTransactionBody,
  TransactionResponse,
} from '@pfm/contracts';

type AccountRow = {
  id: string;
  name: string;
  type: string;
  source: string;
  institution: string | null;
  mask: string | null;
  balanceMinor: number;
  currency: string;
  visibility: string;
  ownerUserId: string | null;
  owner: { name: string } | null;
  createdAt: Date;
};

function toAccountResponse(a: AccountRow): AccountResponse {
  return {
    id: a.id,
    name: a.name,
    type: a.type as AccountResponse['type'],
    source: a.source as AccountResponse['source'],
    institution: a.institution,
    mask: a.mask,
    balanceMinor: a.balanceMinor,
    currency: a.currency,
    visibility: a.visibility as AccountResponse['visibility'],
    ownerUserId: a.ownerUserId,
    ownerName: a.owner?.name ?? null,
    createdAt: a.createdAt.toISOString(),
  };
}

@Injectable()
export class AccountService {
  constructor(private readonly categories: CategoryService) {}

  // ─── Require helpers ────────────────────────────────────────────────────────

  private async requireAccount(accountId: string, householdId: string) {
    const account = await prisma.account.findFirst({
      where: { id: accountId, householdId },
      include: { owner: { select: { name: true } } },
    });
    if (!account) throw new NotFoundException('Account not found');
    return account;
  }

  private requireOwner(account: { ownerUserId: string | null }, userId: string) {
    if (account.ownerUserId !== userId) {
      throw new ForbiddenException('Only the account owner can perform this action');
    }
  }

  // ─── E2.1 / E2.2 — Account CRUD ─────────────────────────────────────────────

  async createAccount(
    householdId: string,
    userId: string,
    body: CreateAccountBody,
  ): Promise<AccountResponse> {
    const account = await prisma.account.create({
      data: {
        householdId,
        ownerUserId: userId,
        name: body.name,
        type: body.type,
        source: 'manual',
        currency: body.currency,
        institution: body.institution ?? null,
        mask: body.mask ?? null,
        visibility: body.visibility,
        balanceMinor: body.initialBalanceMinor,
      },
      include: { owner: { select: { name: true } } },
    });
    return toAccountResponse(account);
  }

  async listAccounts(householdId: string, userId: string): Promise<AccountListResponse> {
    const allAccounts = await prisma.account.findMany({
      where: { householdId },
      include: { owner: { select: { name: true } } },
      orderBy: { createdAt: 'asc' },
    });

    const scope = buildScope(userId, householdId, 'household', allAccounts);

    const own: AccountResponse[] = [];
    const shared: AccountResponse[] = [];

    for (const a of allAccounts) {
      if (a.ownerUserId === userId) {
        own.push(toAccountResponse(a));
      } else if (canViewLineItems(scope, a.id) || scope.balanceOnlyAccountIds.has(a.id)) {
        shared.push(toAccountResponse(a));
      }
    }

    return { own, shared };
  }

  async getAccount(
    accountId: string,
    householdId: string,
    userId: string,
  ): Promise<AccountResponse> {
    const account = await this.requireAccount(accountId, householdId);

    const allAccounts = await prisma.account.findMany({
      where: { householdId },
      select: { id: true, ownerUserId: true, visibility: true },
    });
    const scope = buildScope(userId, householdId, 'household', allAccounts);

    if (
      account.ownerUserId !== userId &&
      !canViewLineItems(scope, accountId) &&
      !scope.balanceOnlyAccountIds.has(accountId)
    ) {
      throw new ForbiddenException('Access denied');
    }

    return toAccountResponse(account);
  }

  async updateAccount(
    accountId: string,
    householdId: string,
    userId: string,
    body: UpdateAccountBody,
  ): Promise<AccountResponse> {
    const account = await this.requireAccount(accountId, householdId);
    this.requireOwner(account, userId);

    const updated = await prisma.account.update({
      where: { id: accountId },
      data: {
        ...(body.name !== undefined && { name: body.name }),
        ...(body.type !== undefined && { type: body.type }),
        ...(body.institution !== undefined && { institution: body.institution }),
        ...(body.mask !== undefined && { mask: body.mask }),
        ...(body.balanceMinor !== undefined && { balanceMinor: body.balanceMinor }),
      },
      include: { owner: { select: { name: true } } },
    });
    return toAccountResponse(updated);
  }

  // ─── E2.3 — Visibility ──────────────────────────────────────────────────────

  async updateVisibility(
    accountId: string,
    householdId: string,
    userId: string,
    body: UpdateVisibilityBody,
  ): Promise<AccountResponse> {
    const account = await this.requireAccount(accountId, householdId);
    this.requireOwner(account, userId);

    const updated = await prisma.account.update({
      where: { id: accountId },
      data: { visibility: body.visibility },
      include: { owner: { select: { name: true } } },
    });
    return toAccountResponse(updated);
  }

  async deleteAccount(
    accountId: string,
    householdId: string,
    userId: string,
  ): Promise<void> {
    const account = await this.requireAccount(accountId, householdId);
    this.requireOwner(account, userId);
    await prisma.account.delete({ where: { id: accountId } });
  }

  // ─── E2.2 — Manual transactions ─────────────────────────────────────────────

  async createTransaction(
    accountId: string,
    householdId: string,
    userId: string,
    body: CreateTransactionBody,
  ): Promise<TransactionResponse> {
    const account = await this.requireAccount(accountId, householdId);
    this.requireOwner(account, userId);

    const merchantNormalized = normalizeMerchant(body.merchant);
    const dedupHash = computeDedupHash(
      accountId,
      body.postedDate,
      body.amountMinor,
      merchantNormalized,
    );

    // E2.4 — skip silently if duplicate
    const existing = await prisma.transaction.findUnique({
      where: { accountId_dedupHash: { accountId, dedupHash } },
    });
    if (existing) throw new ConflictException('Duplicate transaction');

    const currency = body.currency ?? account.currency;

    // Auto-categorize via rules when no explicit categoryId supplied
    const categoryId =
      body.categoryId ??
      (await this.categories.applyRules(account.householdId, body.merchant));

    const [tx] = await prisma.$transaction([
      prisma.transaction.create({
        data: {
          accountId,
          postedDate: new Date(body.postedDate),
          merchant: body.merchant ?? null,
          merchantNormalized: merchantNormalized || null,
          amountMinor: body.amountMinor,
          currency,
          categoryId,
          dedupHash,
        },
      }),
      prisma.account.update({
        where: { id: accountId },
        data: { balanceMinor: { increment: body.amountMinor } },
      }),
    ]);

    return this.toTransactionResponse(tx);
  }

  async listTransactions(
    accountId: string,
    householdId: string,
    userId: string,
  ): Promise<TransactionResponse[]> {
    const allAccounts = await prisma.account.findMany({
      where: { householdId },
      select: { id: true, ownerUserId: true, visibility: true },
    });
    const scope = buildScope(userId, householdId, 'household', allAccounts);

    if (!canViewLineItems(scope, accountId)) {
      throw new ForbiddenException('Access denied');
    }

    const txs = await prisma.transaction.findMany({
      where: { accountId },
      orderBy: { postedDate: 'desc' },
    });

    return txs.map((t) => this.toTransactionResponse(t));
  }

  async updateTransaction(
    txId: string,
    accountId: string,
    householdId: string,
    userId: string,
    body: UpdateTransactionBody,
  ): Promise<TransactionResponse> {
    const account = await this.requireAccount(accountId, householdId);
    this.requireOwner(account, userId);

    const existing = await prisma.transaction.findFirst({
      where: { id: txId, accountId },
    });
    if (!existing) throw new NotFoundException('Transaction not found');

    const newMerchant = body.merchant !== undefined ? body.merchant : existing.merchant;
    const newAmountMinor =
      body.amountMinor !== undefined ? body.amountMinor : existing.amountMinor;
    const newDate = body.postedDate
      ? new Date(body.postedDate)
      : existing.postedDate;
    const merchantNormalized = normalizeMerchant(newMerchant);
    const dedupHash = computeDedupHash(
      accountId,
      newDate.toISOString().slice(0, 10),
      newAmountMinor,
      merchantNormalized,
    );

    const balanceDelta = newAmountMinor - existing.amountMinor;

    const [updated] = await prisma.$transaction([
      prisma.transaction.update({
        where: { id: txId },
        data: {
          postedDate: newDate,
          merchant: newMerchant ?? null,
          merchantNormalized: merchantNormalized || null,
          amountMinor: newAmountMinor,
          ...(body.currency && { currency: body.currency }),
          ...(body.categoryId !== undefined && { categoryId: body.categoryId }),
          dedupHash,
        },
      }),
      prisma.account.update({
        where: { id: accountId },
        data: { balanceMinor: { increment: balanceDelta } },
      }),
    ]);

    return this.toTransactionResponse(updated);
  }

  async deleteTransaction(
    txId: string,
    accountId: string,
    householdId: string,
    userId: string,
  ): Promise<void> {
    const account = await this.requireAccount(accountId, householdId);
    this.requireOwner(account, userId);

    const tx = await prisma.transaction.findFirst({ where: { id: txId, accountId } });
    if (!tx) throw new NotFoundException('Transaction not found');

    await prisma.$transaction([
      prisma.transaction.delete({ where: { id: txId } }),
      prisma.account.update({
        where: { id: accountId },
        data: { balanceMinor: { decrement: tx.amountMinor } },
      }),
    ]);
  }

  private toTransactionResponse(t: {
    id: string;
    accountId: string;
    postedDate: Date;
    merchant: string | null;
    amountMinor: number;
    currency: string;
    categoryId: string | null;
    dedupHash: string;
    createdAt: Date;
  }): TransactionResponse {
    return {
      id: t.id,
      accountId: t.accountId,
      postedDate: t.postedDate.toISOString().slice(0, 10),
      merchant: t.merchant,
      amountMinor: t.amountMinor,
      currency: t.currency,
      categoryId: t.categoryId,
      dedupHash: t.dedupHash,
      createdAt: t.createdAt.toISOString(),
    };
  }
}
