import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { NavShell, Button, FormField, Card, Badge } from '@pfm/ui';
import { api, ApiException } from '../lib/api';
import { useAuth } from '../lib/auth';

type Me = { id: string; email: string; name: string; isSiteAdmin: boolean };
type Household = { id: string; name: string };
type Account = {
  id: string;
  name: string;
  type: string;
  source: string;
  institution: string | null;
  mask: string | null;
  balanceMinor: number;
  currency: string;
  visibility: 'shared' | 'private' | 'balance_only';
  ownerUserId: string | null;
  ownerName: string | null;
  createdAt: string;
};
type AccountList = { own: Account[]; shared: Account[] };

const ACCOUNT_TYPES = [
  { value: 'checking', label: 'Checking' },
  { value: 'savings', label: 'Savings' },
  { value: 'credit_card', label: 'Credit card' },
  { value: 'investment', label: 'Investment' },
  { value: 'loan', label: 'Loan' },
  { value: 'mortgage', label: 'Mortgage' },
  { value: 'other', label: 'Other' },
];

const CURRENCIES = ['USD', 'EUR', 'GBP', 'INR'];

const CURRENCY_SYMBOLS: Record<string, string> = {
  USD: '$', EUR: '€', GBP: '£', INR: '₹',
};

function formatBalance(minor: number, currency: string): string {
  const symbol = CURRENCY_SYMBOLS[currency] ?? currency;
  const abs = Math.abs(minor);
  const major = (abs / 100).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  return minor < 0 ? `−${symbol}${major}` : `${symbol}${major}`;
}

const VISIBILITY_LABELS: Record<string, string> = {
  shared: 'Shared',
  private: 'Private',
  balance_only: 'Balance-only',
};

function VisibilityInfo() {
  return (
    <span className="relative group inline-flex items-center ml-1 cursor-help">
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor"
        className="w-3.5 h-3.5 text-gray-400 group-hover:text-gray-600">
        <path fillRule="evenodd" d="M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0Zm-7-4a1 1 0 1 1-2 0 1 1 0 0 1 2 0ZM9 9a.75.75 0 0 0 0 1.5h.253a.25.25 0 0 1 .244.304l-.459 2.066A1.75 1.75 0 0 0 10.747 15H11a.75.75 0 0 0 0-1.5h-.253a.25.25 0 0 1-.244-.304l.459-2.066A1.75 1.75 0 0 0 9.253 9H9Z" clipRule="evenodd" />
      </svg>
      <span className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-64 rounded-lg bg-gray-800 text-white text-xs p-3 opacity-0 group-hover:opacity-100 transition-opacity z-30 shadow-xl leading-relaxed">
        <span className="block font-semibold">Shared</span>
        <span className="text-gray-300">All household members see transactions and balance.</span>
        <span className="block font-semibold mt-2">Private</span>
        <span className="text-gray-300">Only you see this account — nothing is shared.</span>
        <span className="block font-semibold mt-2">Balance-only</span>
        <span className="text-gray-300">Others see your balance in household totals, but individual transactions are hidden.</span>
        <span className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-gray-800" />
      </span>
    </span>
  );
}

// Gradient bank icon — matches wireframe .bankico style
function BankIcon({ currency }: { currency: string }) {
  const isNonBase = currency !== 'USD';
  return (
    <div
      className={`w-9 h-9 rounded-lg flex-shrink-0 ${
        isNonBase
          ? 'bg-gradient-to-br from-amber-500 to-blue-800'
          : 'bg-gradient-to-br from-blue-600 to-blue-900'
      }`}
    />
  );
}

export function AccountsPage() {
  const { clearTokens } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const { data: me } = useQuery({ queryKey: ['me'], queryFn: () => api.get<Me>('/auth/me') });
  const { data: household } = useQuery({
    queryKey: ['household'],
    queryFn: () => api.get<Household>('/households/me'),
  });

  const { data: accounts, isLoading } = useQuery({
    queryKey: ['accounts', household?.id],
    queryFn: () => api.get<AccountList>(`/households/${household!.id}/accounts`),
    enabled: !!household?.id,
  });

  // ─── Add account form state ──────────────────────────────────────────────────

  const [showAddForm, setShowAddForm] = useState(false);
  const [addName, setAddName] = useState('');
  const [addType, setAddType] = useState('checking');
  const [addCurrency, setAddCurrency] = useState('USD');
  const [addInstitution, setAddInstitution] = useState('');
  const [addMask, setAddMask] = useState('');
  const [addBalance, setAddBalance] = useState('0');
  const [addVisibility, setAddVisibility] = useState<'shared' | 'private' | 'balance_only'>('shared');
  const [addError, setAddError] = useState('');

  const addMutation = useMutation({
    mutationFn: (data: object) =>
      api.post<Account>(`/households/${household!.id}/accounts`, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['accounts'] });
      setShowAddForm(false);
      setAddName(''); setAddType('checking'); setAddCurrency('USD');
      setAddInstitution(''); setAddMask(''); setAddBalance('0');
      setAddVisibility('shared'); setAddError('');
    },
    onError: (err) => setAddError(err instanceof ApiException ? err.message : 'Failed to create account.'),
  });

  function submitAdd(e: React.FormEvent) {
    e.preventDefault();
    const balanceCents = Math.round(parseFloat(addBalance || '0') * 100);
    addMutation.mutate({
      name: addName,
      type: addType,
      currency: addCurrency,
      institution: addInstitution || undefined,
      mask: addMask || undefined,
      visibility: addVisibility,
      initialBalanceMinor: isNaN(balanceCents) ? 0 : balanceCents,
    });
  }

  // ─── Visibility change ───────────────────────────────────────────────────────

  async function changeVisibility(accountId: string, visibility: string) {
    if (!household) return;
    await api.patch(`/households/${household.id}/accounts/${accountId}/visibility`, { visibility });
    qc.invalidateQueries({ queryKey: ['accounts'] });
  }

  // ─── Delete account ──────────────────────────────────────────────────────────

  async function deleteAccount(accountId: string) {
    if (!household) return;
    if (!confirm('Delete this account? All its transactions will also be deleted.')) return;
    await api.delete(`/households/${household.id}/accounts/${accountId}`);
    qc.invalidateQueries({ queryKey: ['accounts'] });
  }

  async function handleSignOut() {
    const refreshToken = localStorage.getItem('refreshToken');
    if (refreshToken) api.post('/auth/logout', { refreshToken }).catch(() => undefined);
    clearTokens();
    navigate('/login');
  }

  const navItems = [
    { label: 'Dashboard', href: '/dashboard', active: false },
    { label: 'Accounts', href: '/accounts', active: true },
    { label: 'Household', href: '/settings/household', active: false },
    ...(me?.isSiteAdmin ? [{ label: 'Admin', href: '/admin', active: false }] : []),
  ];

  const own = accounts?.own ?? [];
  const shared = accounts?.shared ?? [];

  return (
    <NavShell navItems={navItems} userEmail={me?.email ?? ''} onSignOut={handleSignOut}>
      <div className="p-6 max-w-4xl space-y-5">

        {/* Page header */}
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-semibold text-gray-900">Accounts</h1>
          <div className="flex gap-2">
            <Button variant="secondary" disabled>
              ↥ Import statement
            </Button>
            <Button onClick={() => setShowAddForm((v) => !v)}>
              + Add account
            </Button>
          </div>
        </div>

        {/* Add an account — dashed card (always visible; expands manual form on click) */}
        <div className="rounded-xl border-2 border-dashed border-blue-200 bg-blue-50/40 p-5">
          <p className="text-sm font-semibold text-gray-900 mb-4">Add an account</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">

            {/* Upload a statement — Phase 1 (Epic 3) */}
            <div
              className="bg-white border-2 border-emerald-600 rounded-xl p-5 text-center cursor-pointer opacity-50 select-none"
              title="Coming in Epic 3 — Import"
            >
              <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-emerald-600 to-blue-800 mx-auto mb-3" />
              <p className="font-semibold text-sm text-gray-900 mb-1">
                Upload a statement{' '}
                <Badge variant="success" className="text-[10px]">Phase 1</Badge>
              </p>
              <p className="text-xs text-gray-500 mb-3">
                Upload CSV / OFX / QFX downloaded from your bank. No login stored.
              </p>
              <Button variant="secondary" disabled className="text-xs px-3 py-1">
                Choose file
              </Button>
            </div>

            {/* Connect automatically — Phase 2 */}
            <div className="bg-white border border-gray-200 rounded-xl p-5 text-center opacity-50 select-none">
              <div className="w-9 h-9 rounded-lg bg-gray-300 mx-auto mb-3" />
              <p className="font-semibold text-sm text-gray-900 mb-1">
                Connect automatically{' '}
                <Badge variant="info" className="text-[10px]">Phase 2</Badge>
              </p>
              <p className="text-xs text-gray-500 mb-3">
                Link your bank/card via Plaid for live updates. Coming in Phase 2.
              </p>
              <Button variant="secondary" disabled className="text-xs px-3 py-1">
                Connect
              </Button>
            </div>
          </div>

          {/* Inline manual account form — toggled by "+ Add account" button */}
          {showAddForm && (
            <form onSubmit={submitAdd} className="mt-4 border-t border-blue-100 pt-4 space-y-4">
              <p className="text-sm font-semibold text-gray-800">Add a manual account</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <FormField
                  label="Account name"
                  name="addName"
                  type="text"
                  value={addName}
                  onChange={(e) => setAddName(e.target.value)}
                  placeholder="e.g. Chase Checking"
                  required
                />
                <div className="space-y-1">
                  <label className="block text-sm font-medium text-gray-700">Type</label>
                  <select
                    value={addType}
                    onChange={(e) => setAddType(e.target.value)}
                    className="block w-full h-[38px] rounded-lg border border-gray-300 px-3 py-2 text-sm"
                  >
                    {ACCOUNT_TYPES.map((t) => (
                      <option key={t.value} value={t.value}>{t.label}</option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="block text-sm font-medium text-gray-700">Currency</label>
                  <select
                    value={addCurrency}
                    onChange={(e) => setAddCurrency(e.target.value)}
                    className="block w-full h-[38px] rounded-lg border border-gray-300 px-3 py-2 text-sm"
                  >
                    {CURRENCIES.map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="flex items-center text-sm font-medium text-gray-700">
                    Visibility <VisibilityInfo />
                  </label>
                  <select
                    value={addVisibility}
                    onChange={(e) => setAddVisibility(e.target.value as typeof addVisibility)}
                    className="block w-full h-[38px] rounded-lg border border-gray-300 px-3 py-2 text-sm"
                  >
                    <option value="shared">Shared</option>
                    <option value="private">Private</option>
                    <option value="balance_only">Balance-only</option>
                  </select>
                </div>
                <FormField
                  label="Institution (optional)"
                  name="addInstitution"
                  type="text"
                  value={addInstitution}
                  onChange={(e) => setAddInstitution(e.target.value)}
                  placeholder="e.g. Chase"
                />
                <FormField
                  label="Last 4 digits (optional)"
                  name="addMask"
                  type="text"
                  value={addMask}
                  onChange={(e) => setAddMask(e.target.value)}
                  placeholder="4821"
                  maxLength={4}
                />
                <FormField
                  label="Opening balance"
                  name="addBalance"
                  type="number"
                  value={addBalance}
                  onChange={(e) => setAddBalance(e.target.value)}
                  step="0.01"
                />
              </div>
              {addError && <p className="text-sm text-red-600">{addError}</p>}
              <div className="flex gap-2">
                <Button type="submit" loading={addMutation.isPending}>Add account</Button>
                <Button type="button" variant="secondary" onClick={() => { setShowAddForm(false); setAddError(''); }}>
                  Cancel
                </Button>
              </div>
            </form>
          )}
        </div>

        {/* Your accounts */}
        {!isLoading && (
          <Card padding="none">
            <div className="px-5 pt-4 pb-2 flex items-center justify-between">
              <p className="text-sm font-semibold text-gray-900">
                {me?.name ? `${me.name}'s accounts` : 'Your accounts'}
                <span className="ml-2 text-xs font-normal text-blue-600">you</span>
              </p>
            </div>
            {own.length === 0 ? (
              <p className="px-5 pb-4 text-sm text-gray-400">No accounts yet. Add one above.</p>
            ) : (
              <div className="divide-y divide-gray-100">
                {own.map((acct) => (
                  <div key={acct.id} className="flex items-center justify-between px-5 py-3 gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <BankIcon currency={acct.currency} />
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-gray-900 truncate">
                          {acct.name}
                          {acct.currency !== (household as any)?.baseCurrency &&
                            acct.currency !== 'USD' && (
                              <Badge variant="info" className="ml-1.5 text-[10px]">
                                {acct.currency}
                              </Badge>
                            )}
                        </p>
                        <p className="text-xs text-gray-500">
                          {acct.mask ? `····${acct.mask} · ` : ''}
                          {formatBalance(acct.balanceMinor, acct.currency)}
                          {acct.currency !== 'USD' && (
                            <span className="text-gray-400"> · shown natively, not in USD totals</span>
                          )}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <div className="flex items-center gap-1">
                        <select
                          value={acct.visibility}
                          onChange={(e) => changeVisibility(acct.id, e.target.value)}
                          className="text-xs border border-gray-200 rounded-md px-2 py-1.5 bg-white text-gray-700"
                        >
                          <option value="shared">Shared ✓</option>
                          <option value="private">Private</option>
                          <option value="balance_only">Balance-only</option>
                        </select>
                        <VisibilityInfo />
                      </div>
                      <button
                        onClick={() => deleteAccount(acct.id)}
                        className="text-xs text-red-400 hover:text-red-600"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        )}

        {/* Shared with you */}
        {shared.length > 0 && (
          <Card padding="none">
            <div className="px-5 pt-4 pb-2 flex items-center justify-between">
              <p className="text-sm font-semibold text-gray-900">
                Shared with you
                <span className="ml-2 text-xs font-normal text-blue-600">from household</span>
              </p>
            </div>
            <div className="divide-y divide-gray-100">
              {shared.map((acct) => (
                <div key={acct.id} className="flex items-center justify-between px-5 py-3 gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <BankIcon currency={acct.currency} />
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-900 truncate">
                        {acct.name}{' '}
                        <Badge
                          variant={acct.visibility === 'shared' ? 'success' : 'info'}
                          className="text-[10px]"
                        >
                          {VISIBILITY_LABELS[acct.visibility]}
                        </Badge>
                      </p>
                      <p className="text-xs text-gray-500">
                        {acct.ownerName ? `Connected by ${acct.ownerName} · ` : ''}
                        {acct.visibility === 'balance_only'
                          ? 'Counts toward totals · items hidden'
                          : formatBalance(acct.balanceMinor, acct.currency)}
                      </p>
                    </div>
                  </div>
                  <span className="text-xs text-gray-400 flex-shrink-0">view only</span>
                </div>
              ))}
            </div>
          </Card>
        )}

        {/* Currency note */}
        <div className="bg-blue-50 border-l-4 border-blue-300 rounded-r-lg px-4 py-3 text-xs text-gray-700 leading-relaxed">
          <span className="font-semibold">Currency:</span> each account keeps its own currency
          (USD / EUR / GBP / INR). Amounts are never converted in Phase 1 — non-base-currency
          accounts appear natively and in a separate per-currency breakdown rather than being
          blended into the base-currency totals.
        </div>

      </div>
    </NavShell>
  );
}
