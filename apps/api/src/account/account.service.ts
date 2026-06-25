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
import { EncryptionService } from '../common/encryption.service';
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

// Shape of a decrypted account row (all encrypted fields already plaintext)
type AccountRow = {
  id: string;
  name: string;
  type: string;
  source: string;
  institution: string | null;
  mask: string | null;
  balanceMinor: number;
  balanceAsOf: Date | null;
  currency: string;
  visibility: string;
  ownerUserId: string | null;
  owner: { name: string } | null;
  createdAt: Date;
};

// Transactions use a unified sign: money into the account = positive, money out = negative.
// For asset accounts (checking, savings): balance = opening + tx_sum (charges reduce balance).
// For liability accounts (credit_card, loan, mortgage): transactions are stored with the same
// sign convention (charges = negative expense, payments = positive income), but this means
// charges REDUCE the stored balance when added — the opposite of what's owed. So we negate
// the tx_sum for liabilities: owed = opening + (-tx_sum) → charges increase what's owed.
const LIABILITY_ACCOUNT_TYPES = new Set(['credit_card', 'loan', 'mortgage']);

function toAccountResponse(a: AccountRow, txSumMinor = 0, lastTxDate?: Date | null): AccountResponse {
  const delta = LIABILITY_ACCOUNT_TYPES.has(a.type) ? -txSumMinor : txSumMinor;
  return {
    id: a.id,
    name: a.name,
    type: a.type as AccountResponse['type'],
    source: a.source as AccountResponse['source'],
    institution: a.institution,
    mask: a.mask,
    balanceMinor: a.balanceMinor + delta,
    openingBalanceMinor: a.balanceMinor,
    balanceAsOfDate: a.balanceAsOf ? a.balanceAsOf.toISOString().slice(0, 10) : null,
    lastTransactionDate: lastTxDate ? lastTxDate.toISOString().slice(0, 10) : null,
    currency: a.currency,
    visibility: a.visibility as AccountResponse['visibility'],
    ownerUserId: a.ownerUserId,
    ownerName: a.owner?.name ?? null,
    createdAt: a.createdAt.toISOString(),
  };
}

@Injectable()
export class AccountService {
  constructor(
    private readonly categories: CategoryService,
    private readonly encryption: EncryptionService,
  ) {}

  // ─── Encryption helpers ────────────────────────────────────────────────────

  private encAccount(householdId: string) {
    return (p: string) => this.encryption.encrypt(p, householdId);
  }

  private decAccount(raw: {
    id: string; name: string; type: string; source: string;
    institution: string | null; mask: string | null; balanceMinor: string;
    balanceAsOf: Date | null; currency: string; visibility: string;
    ownerUserId: string | null; owner: { name: string } | null; createdAt: Date;
  }, householdId: string): AccountRow {
    const enc = this.encAccount(householdId);
    void enc; // enc is for writes; for reads, use decrypt
    return {
      ...raw,
      name: this.encryption.decrypt(raw.name, householdId),
      institution: raw.institution ? this.encryption.decrypt(raw.institution, householdId) : null,
      mask: raw.mask ? this.encryption.decrypt(raw.mask, householdId) : null,
      balanceMinor: parseInt(this.encryption.decrypt(raw.balanceMinor, householdId), 10),
    };
  }

  private encryptTxFields(
    amountMinor: number,
    merchant: string | null | undefined,
    merchantNormalized: string,
    householdId: string,
  ) {
    const enc = (p: string) => this.encryption.encrypt(p, householdId);
    return {
      amountMinor: enc(String(amountMinor)),
      merchant: merchant != null ? enc(merchant) : null,
      merchantNormalized: merchantNormalized || null
        ? enc(merchantNormalized || '')
        : null,
      merchantRuleHash: merchantNormalized
        ? this.encryption.hmac(merchantNormalized)
        : null,
    };
  }

  private decryptTxAmount(encAmount: string, householdId: string): number {
    return parseInt(this.encryption.decrypt(encAmount, householdId), 10);
  }

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
        name: this.encryption.encrypt(body.name, householdId),
        type: body.type,
        source: 'manual',
        currency: body.currency,
        institution: body.institution ? this.encryption.encrypt(body.institution, householdId) : null,
        mask: body.mask ? this.encryption.encrypt(body.mask, householdId) : null,
        visibility: body.visibility,
        balanceMinor: this.encryption.encrypt(String(body.initialBalanceMinor), householdId),
        balanceAsOf: body.balanceAsOfDate ? new Date(body.balanceAsOfDate) : null,
      },
      include: { owner: { select: { name: true } } },
    });
    return toAccountResponse(this.decAccount(account, householdId));
  }

  async listAccounts(householdId: string, userId: string): Promise<AccountListResponse> {
    const allAccounts = await prisma.account.findMany({
      where: { householdId },
      include: { owner: { select: { name: true } } },
      orderBy: { createdAt: 'asc' },
    });

    const accountIds = allAccounts.map((a) => a.id);

    // Fetch all transactions and compute per-account sum + max date in JS
    // (SQL _sum can't aggregate encrypted strings)
    const allTxs = await prisma.transaction.findMany({
      where: { accountId: { in: accountIds } },
      select: { accountId: true, amountMinor: true, postedDate: true },
    });

    const txSumMap = new Map<string, number>();
    const txMaxDateMap = new Map<string, Date | null>();

    for (const tx of allTxs) {
      const amount = this.decryptTxAmount(tx.amountMinor, householdId);
      txSumMap.set(tx.accountId, (txSumMap.get(tx.accountId) ?? 0) + amount);
      const cur = txMaxDateMap.get(tx.accountId);
      if (!cur || tx.postedDate > cur) txMaxDateMap.set(tx.accountId, tx.postedDate);
    }

    // Subtract pre-cutoff transactions for accounts with a balanceAsOf date
    const accountsWithCutoff = allAccounts.filter((a) => a.balanceAsOf !== null);
    for (const a of accountsWithCutoff) {
      const preTxs = await prisma.transaction.findMany({
        where: { accountId: a.id, postedDate: { lte: a.balanceAsOf! } },
        select: { amountMinor: true },
      });
      const preSum = preTxs.reduce(
        (s, tx) => s + this.decryptTxAmount(tx.amountMinor, householdId),
        0,
      );
      txSumMap.set(a.id, (txSumMap.get(a.id) ?? 0) - preSum);
    }

    const scope = buildScope(userId, householdId, 'household', allAccounts);

    const own: AccountResponse[] = [];
    const shared: AccountResponse[] = [];

    for (const a of allAccounts) {
      const txSum = txSumMap.get(a.id) ?? 0;
      const lastTxDate = txMaxDateMap.get(a.id) ?? null;
      const decrypted = this.decAccount(a, householdId);
      if (a.ownerUserId === userId) {
        own.push(toAccountResponse(decrypted, txSum, lastTxDate));
      } else if (canViewLineItems(scope, a.id) || scope.balanceOnlyAccountIds.has(a.id)) {
        shared.push(toAccountResponse(decrypted, txSum, lastTxDate));
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

    // Fetch all post-cutoff transactions and sum in JS
    const txs = await prisma.transaction.findMany({
      where: {
        accountId,
        ...(account.balanceAsOf ? { postedDate: { gt: account.balanceAsOf } } : {}),
      },
      select: { amountMinor: true, postedDate: true },
    });
    const txSum = txs.reduce((s, tx) => s + this.decryptTxAmount(tx.amountMinor, householdId), 0);
    const maxDate = txs.reduce<Date | null>((m, tx) => (!m || tx.postedDate > m ? tx.postedDate : m), null);

    // For lastTransactionDate, check ALL transactions
    let lastTxDate: Date | null = maxDate;
    if (account.balanceAsOf) {
      const allTxDates = await prisma.transaction.findMany({
        where: { accountId },
        select: { postedDate: true },
      });
      lastTxDate = allTxDates.reduce<Date | null>((m, tx) => (!m || tx.postedDate > m ? tx.postedDate : m), null);
    }

    return toAccountResponse(this.decAccount(account, householdId), txSum, lastTxDate);
  }

  async updateAccount(
    accountId: string,
    householdId: string,
    userId: string,
    body: UpdateAccountBody,
  ): Promise<AccountResponse> {
    const account = await this.requireAccount(accountId, householdId);
    this.requireOwner(account, userId);

    const enc = (p: string) => this.encryption.encrypt(p, householdId);
    const updated = await prisma.account.update({
      where: { id: accountId },
      data: {
        ...(body.name !== undefined && { name: enc(body.name) }),
        ...(body.type !== undefined && { type: body.type }),
        ...(body.institution !== undefined && {
          institution: body.institution != null ? enc(body.institution) : null,
        }),
        ...(body.mask !== undefined && {
          mask: body.mask != null ? enc(body.mask) : null,
        }),
        ...(body.balanceMinor !== undefined && { balanceMinor: enc(String(body.balanceMinor)) }),
        ...('balanceAsOfDate' in body && {
          balanceAsOf: body.balanceAsOfDate ? new Date(body.balanceAsOfDate) : null,
        }),
      },
      include: { owner: { select: { name: true } } },
    });
    return toAccountResponse(this.decAccount(updated, householdId));
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
    return toAccountResponse(this.decAccount(updated, householdId));
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

    const tx = await prisma.transaction.create({
      data: {
        accountId,
        postedDate: new Date(body.postedDate),
        ...this.encryptTxFields(body.amountMinor, body.merchant ?? null, merchantNormalized, householdId),
        currency,
        categoryId,
        dedupHash,
      },
    });

    return this.toTransactionResponse(tx, householdId);
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

    return txs.map((t) => this.toTransactionResponse(t, householdId));
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

    const existingMerchant = existing.merchant
      ? this.encryption.decrypt(existing.merchant, householdId)
      : null;
    const existingAmount = this.decryptTxAmount(existing.amountMinor, householdId);

    const newMerchant = body.merchant !== undefined ? body.merchant : existingMerchant;
    const newAmountMinor = body.amountMinor !== undefined ? body.amountMinor : existingAmount;
    const newDate = body.postedDate ? new Date(body.postedDate) : existing.postedDate;
    const merchantNormalized = normalizeMerchant(newMerchant);
    const dedupHash = computeDedupHash(
      accountId,
      newDate.toISOString().slice(0, 10),
      newAmountMinor,
      merchantNormalized,
    );

    const updated = await prisma.transaction.update({
      where: { id: txId },
      data: {
        postedDate: newDate,
        ...this.encryptTxFields(newAmountMinor, newMerchant, merchantNormalized, householdId),
        ...(body.currency && { currency: body.currency }),
        ...(body.categoryId !== undefined && { categoryId: body.categoryId }),
        dedupHash,
      },
    });

    return this.toTransactionResponse(updated, householdId);
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

    await prisma.transaction.delete({ where: { id: txId } });
  }

  private toTransactionResponse(t: {
    id: string;
    accountId: string;
    postedDate: Date;
    merchant: string | null;
    amountMinor: string;
    currency: string;
    categoryId: string | null;
    dedupHash: string;
    createdAt: Date;
  }, householdId: string): TransactionResponse {
    return {
      id: t.id,
      accountId: t.accountId,
      postedDate: t.postedDate.toISOString().slice(0, 10),
      merchant: t.merchant ? this.encryption.decrypt(t.merchant, householdId) : null,
      amountMinor: this.decryptTxAmount(t.amountMinor, householdId),
      currency: t.currency,
      categoryId: t.categoryId,
      dedupHash: t.dedupHash,
      createdAt: t.createdAt.toISOString(),
    };
  }
}
