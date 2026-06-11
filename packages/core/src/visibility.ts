// E0.5 — Visibility scope helper.
// This is the most security-critical function in the codebase.
// Every repository read of account/transaction/balance data MUST pass through a Scope.
//
// Design: pure function — no DB calls, no framework deps. The API layer fetches accounts,
// then calls buildScope. This keeps @pfm/core testable without a real database.

export type VisibilityKind = 'shared' | 'private' | 'balance_only';

export interface ScopeAccount {
  id: string;
  // null when the original owner was removed from the household (E1.4 detach)
  ownerUserId: string | null;
  visibility: VisibilityKind;
}

export interface Scope {
  viewerUserId: string;
  householdId: string;
  mode: 'household' | 'personal';
  // Accounts whose line items AND balance the viewer can see
  lineItemAccountIds: Set<string>;
  // Accounts whose balance rolls into totals but line items are hidden from this viewer
  balanceOnlyAccountIds: Set<string>;
}

/**
 * Build a visibility scope for a viewer.
 *
 * Rules (from PRD A-3 / NFR-2):
 *  - Owner always sees their own accounts fully (line items + balance), regardless of visibility setting.
 *  - shared      → all household members see line items + balance.
 *  - private     → only the owner sees it at all.
 *  - balance_only → others see balance in totals; line items hidden from non-owners.
 *  - personal mode → only the viewer's own accounts appear (line items + balance).
 *
 * @param viewerUserId   The authenticated user making the request.
 * @param householdId    The household being viewed.
 * @param mode           'household' = shared dashboard; 'personal' = viewer's own accounts.
 * @param accounts       All accounts belonging to this household (pre-fetched by the caller).
 */
export function buildScope(
  viewerUserId: string,
  householdId: string,
  mode: 'household' | 'personal',
  accounts: ScopeAccount[],
): Scope {
  const lineItemAccountIds = new Set<string>();
  const balanceOnlyAccountIds = new Set<string>();

  for (const account of accounts) {
    const isOwner = account.ownerUserId === viewerUserId;

    if (mode === 'personal') {
      // Personal mode: only the viewer's own accounts
      if (isOwner) lineItemAccountIds.add(account.id);
      continue;
    }

    // Household mode
    if (isOwner) {
      lineItemAccountIds.add(account.id);
      continue;
    }

    // Non-owner in household mode
    switch (account.visibility) {
      case 'shared':
        lineItemAccountIds.add(account.id);
        break;
      case 'balance_only':
        balanceOnlyAccountIds.add(account.id);
        break;
      case 'private':
        // Not visible to this viewer at all
        break;
    }
  }

  return { viewerUserId, householdId, mode, lineItemAccountIds, balanceOnlyAccountIds };
}

/**
 * Returns true if the viewer may see line items for this account.
 */
export function canViewLineItems(scope: Scope, accountId: string): boolean {
  return scope.lineItemAccountIds.has(accountId);
}

/**
 * Returns true if the account balance should be included in totals for this viewer.
 */
export function canViewBalance(scope: Scope, accountId: string): boolean {
  return scope.lineItemAccountIds.has(accountId) || scope.balanceOnlyAccountIds.has(accountId);
}

/**
 * All account IDs that contribute balance to this viewer's totals.
 */
export function balanceAccountIds(scope: Scope): Set<string> {
  return new Set([...scope.lineItemAccountIds, ...scope.balanceOnlyAccountIds]);
}
