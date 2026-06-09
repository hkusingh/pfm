import { describe, it, expect } from 'vitest';
import {
  buildScope,
  canViewLineItems,
  canViewBalance,
  balanceAccountIds,
  type ScopeAccount,
} from './visibility';

const VIEWER = 'user-1';
const OTHER = 'user-2';
const HH = 'household-1';

function makeAccount(
  id: string,
  ownerUserId: string,
  visibility: ScopeAccount['visibility'],
): ScopeAccount {
  return { id, ownerUserId, visibility };
}

// ─── Household mode ──────────────────────────────────────────────────────────

describe('household mode — shared account', () => {
  const account = makeAccount('acc-shared', OTHER, 'shared');
  const scope = buildScope(VIEWER, HH, 'household', [account]);

  it('viewer can see line items', () => expect(canViewLineItems(scope, 'acc-shared')).toBe(true));
  it('viewer can see balance', () => expect(canViewBalance(scope, 'acc-shared')).toBe(true));
  it('appears in balanceAccountIds', () => expect(balanceAccountIds(scope).has('acc-shared')).toBe(true));
});

describe('household mode — private account (non-owner)', () => {
  const account = makeAccount('acc-private', OTHER, 'private');
  const scope = buildScope(VIEWER, HH, 'household', [account]);

  it('viewer cannot see line items', () => expect(canViewLineItems(scope, 'acc-private')).toBe(false));
  it('viewer cannot see balance', () => expect(canViewBalance(scope, 'acc-private')).toBe(false));
  it('absent from balanceAccountIds', () => expect(balanceAccountIds(scope).has('acc-private')).toBe(false));
});

describe('household mode — balance_only account (non-owner)', () => {
  const account = makeAccount('acc-bal', OTHER, 'balance_only');
  const scope = buildScope(VIEWER, HH, 'household', [account]);

  it('viewer cannot see line items', () => expect(canViewLineItems(scope, 'acc-bal')).toBe(false));
  it('balance rolls into totals', () => expect(canViewBalance(scope, 'acc-bal')).toBe(true));
  it('appears in balanceAccountIds', () => expect(balanceAccountIds(scope).has('acc-bal')).toBe(true));
});

describe('household mode — owner always sees own accounts fully', () => {
  it('owner sees own private account (line items + balance)', () => {
    const account = makeAccount('acc-own', VIEWER, 'private');
    const scope = buildScope(VIEWER, HH, 'household', [account]);
    expect(canViewLineItems(scope, 'acc-own')).toBe(true);
    expect(canViewBalance(scope, 'acc-own')).toBe(true);
  });

  it('owner sees own balance_only account fully', () => {
    const account = makeAccount('acc-own-bal', VIEWER, 'balance_only');
    const scope = buildScope(VIEWER, HH, 'household', [account]);
    expect(canViewLineItems(scope, 'acc-own-bal')).toBe(true);
  });
});

// ─── Personal mode ────────────────────────────────────────────────────────────

describe('personal mode', () => {
  const ownAccount = makeAccount('acc-own', VIEWER, 'shared');
  const otherShared = makeAccount('acc-other-shared', OTHER, 'shared');
  const otherPrivate = makeAccount('acc-other-private', OTHER, 'private');

  const scope = buildScope(VIEWER, HH, 'personal', [ownAccount, otherShared, otherPrivate]);

  it('own account is visible', () => expect(canViewLineItems(scope, 'acc-own')).toBe(true));
  it('other shared account hidden in personal mode', () =>
    expect(canViewLineItems(scope, 'acc-other-shared')).toBe(false));
  it('other private account hidden in personal mode', () =>
    expect(canViewLineItems(scope, 'acc-other-private')).toBe(false));
  it('other accounts not in balanceAccountIds in personal mode', () => {
    const ids = balanceAccountIds(scope);
    expect(ids.has('acc-other-shared')).toBe(false);
    expect(ids.has('acc-other-private')).toBe(false);
  });
});

// ─── No cross-member leakage proofs ──────────────────────────────────────────

describe('leakage: viewer A cannot see viewer B private accounts', () => {
  const userA = 'user-a';
  const userB = 'user-b';
  const accounts: ScopeAccount[] = [
    makeAccount('a-shared', userA, 'shared'),
    makeAccount('b-private', userB, 'private'),
    makeAccount('b-bal', userB, 'balance_only'),
    makeAccount('b-shared', userB, 'shared'),
  ];

  const scopeA = buildScope(userA, HH, 'household', accounts);

  it('A cannot see B private line items', () => expect(canViewLineItems(scopeA, 'b-private')).toBe(false));
  it('A cannot see B private balance', () => expect(canViewBalance(scopeA, 'b-private')).toBe(false));
  it('A can see B balance_only balance (but not line items)', () => {
    expect(canViewLineItems(scopeA, 'b-bal')).toBe(false);
    expect(canViewBalance(scopeA, 'b-bal')).toBe(true);
  });
  it('A can see B shared account fully', () => {
    expect(canViewLineItems(scopeA, 'b-shared')).toBe(true);
    expect(canViewBalance(scopeA, 'b-shared')).toBe(true);
  });
});

describe('leakage: unknown accountId never leaks', () => {
  const scope = buildScope(VIEWER, HH, 'household', []);
  it('canViewLineItems returns false for unknown id', () =>
    expect(canViewLineItems(scope, 'no-such-account')).toBe(false));
  it('canViewBalance returns false for unknown id', () =>
    expect(canViewBalance(scope, 'no-such-account')).toBe(false));
});

// ─── Empty household ──────────────────────────────────────────────────────────

describe('empty account list', () => {
  const scope = buildScope(VIEWER, HH, 'household', []);
  it('lineItemAccountIds is empty', () => expect(scope.lineItemAccountIds.size).toBe(0));
  it('balanceOnlyAccountIds is empty', () => expect(scope.balanceOnlyAccountIds.size).toBe(0));
});
