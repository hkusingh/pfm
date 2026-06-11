import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { NavShell, Card } from '@pfm/ui';
import { api, ApiException } from '../lib/api';
import { useAuth } from '../lib/auth';

type Me = { id: string; email: string; name: string; isSiteAdmin: boolean };
type Household = { id: string; name: string };
type Account = { id: string; name: string };
type Category = { id: string; name: string; color: string | null; parentId: string | null; children?: Category[] };

type TransactionItem = {
  id: string;
  accountId: string;
  accountName: string;
  postedDate: string;
  merchant: string | null;
  amountMinor: number;
  currency: string;
  categoryId: string | null;
  categoryName: string | null;
  categoryColor: string | null;
  dedupHash: string;
  createdAt: string;
};

type TxListResponse = {
  items: TransactionItem[];
  total: number;
  page: number;
  limit: number;
};

const CURRENCY_SYMBOLS: Record<string, string> = {
  USD: '$', EUR: '€', GBP: '£', INR: '₹',
};

function formatAmount(minor: number, currency: string): string {
  const symbol = CURRENCY_SYMBOLS[currency] ?? currency;
  const abs = Math.abs(minor);
  const major = (abs / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return minor < 0 ? `−${symbol}${major}` : `+${symbol}${major}`;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function CategoryPill({
  name,
  color,
  onClick,
}: {
  name: string | null;
  color: string | null;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="inline-flex items-center gap-1.5 text-xs border rounded-full px-2 py-0.5 bg-white hover:bg-gray-50 transition-colors"
      style={{ borderColor: color ?? '#cbd5e0' }}
    >
      <span
        className="w-2 h-2 rounded-full flex-shrink-0"
        style={{ background: color ?? '#A0AEC0' }}
      />
      {name ?? 'Uncategorized'}
      <span className="text-gray-400">▾</span>
    </button>
  );
}

export function TransactionsPage() {
  const { clearTokens } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const { data: me } = useQuery({ queryKey: ['me'], queryFn: () => api.get<Me>('/auth/me') });
  const { data: household } = useQuery({
    queryKey: ['household'],
    queryFn: () => api.get<Household>('/households/me'),
  });

  // ── Filters ──────────────────────────────────────────────────────────────
  const [search, setSearch] = useState('');
  const [filterAccount, setFilterAccount] = useState('');
  const [filterCategory, setFilterCategory] = useState('');
  const [filterFrom, setFilterFrom] = useState('');
  const [filterTo, setFilterTo] = useState('');
  const [page, setPage] = useState(1);
  const LIMIT = 50;

  const params = new URLSearchParams();
  if (search) params.set('search', search);
  if (filterAccount) params.set('accountId', filterAccount);
  if (filterCategory) params.set('categoryId', filterCategory);
  if (filterFrom) params.set('from', filterFrom);
  if (filterTo) params.set('to', filterTo);
  params.set('page', String(page));
  params.set('limit', String(LIMIT));

  const { data: txData, isLoading } = useQuery({
    queryKey: ['transactions', household?.id, params.toString()],
    queryFn: () =>
      api.get<TxListResponse>(`/households/${household!.id}/transactions?${params.toString()}`),
    enabled: !!household?.id,
  });

  const { data: accounts = [] } = useQuery({
    queryKey: ['accounts-flat', household?.id],
    queryFn: async () => {
      const r = await api.get<{ own: Account[]; shared: Account[] }>(`/households/${household!.id}/accounts`);
      return [...r.own, ...r.shared];
    },
    enabled: !!household?.id,
  });

  const { data: categories = [] } = useQuery({
    queryKey: ['categories', household?.id],
    queryFn: () => api.get<Category[]>(`/households/${household!.id}/categories`),
    enabled: !!household?.id,
  });

  // Flat list of all categories for dropdowns
  const allCategories: Category[] = [];
  for (const p of categories) {
    allCategories.push(p);
    for (const ch of p.children ?? []) allCategories.push(ch);
  }

  // ── Recategorize panel ───────────────────────────────────────────────────
  const [recatTx, setRecatTx] = useState<TransactionItem | null>(null);
  const [recatCatId, setRecatCatId] = useState<string>('');
  const [recatCreateRule, setRecatCreateRule] = useState(false);
  const [recatError, setRecatError] = useState('');

  function openRecat(tx: TransactionItem) {
    setRecatTx(tx);
    setRecatCatId(tx.categoryId ?? '');
    setRecatCreateRule(false);
    setRecatError('');
  }

  const recatMutation = useMutation({
    mutationFn: () => {
      if (!household || !recatTx) throw new Error('missing');
      return api.patch<TransactionItem>(
        `/households/${household.id}/transactions/${recatTx.id}/category`,
        { categoryId: recatCatId || null, createRule: recatCreateRule },
      );
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['transactions'] });
      setRecatTx(null);
    },
    onError: (err) => setRecatError(err instanceof ApiException ? err.message : 'Failed to save.'),
  });

  // ── Nav ──────────────────────────────────────────────────────────────────
  const navItems = [
    { label: 'Dashboard', href: '/dashboard', active: false },
    { label: 'Transactions', href: '/transactions', active: true },
    { label: 'Accounts', href: '/accounts', active: false },
    { label: 'Categories', href: '/categories', active: false },
    { label: 'Household', href: '/settings/household', active: false },
    ...(me?.isSiteAdmin ? [{ label: 'Admin', href: '/admin', active: false }] : []),
  ];

  async function handleSignOut() {
    const rt = localStorage.getItem('refreshToken');
    if (rt) api.post('/auth/logout', { refreshToken: rt }).catch(() => undefined);
    clearTokens();
    navigate('/login');
  }

  const items = txData?.items ?? [];
  const total = txData?.total ?? 0;
  const totalPages = Math.ceil(total / LIMIT);

  return (
    <NavShell navItems={navItems} userEmail={me?.email ?? ''} onSignOut={handleSignOut}>
      <div className="p-6 max-w-5xl space-y-4">

        {/* Header + search */}
        <div className="flex items-center justify-between gap-4">
          <h1 className="text-xl font-semibold text-gray-900">Transactions</h1>
          <input
            type="text"
            placeholder="Search…"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            className="w-56 h-[36px] rounded-lg border border-gray-300 px-3 text-sm placeholder-gray-400"
          />
        </div>

        {/* Filter row */}
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <select
            value={filterAccount}
            onChange={(e) => { setFilterAccount(e.target.value); setPage(1); }}
            className="h-[34px] rounded-lg border border-gray-200 px-2 text-xs bg-white text-gray-700"
          >
            <option value="">All accounts</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </select>

          <select
            value={filterCategory}
            onChange={(e) => { setFilterCategory(e.target.value); setPage(1); }}
            className="h-[34px] rounded-lg border border-gray-200 px-2 text-xs bg-white text-gray-700"
          >
            <option value="">All categories</option>
            <option value="uncategorized">Uncategorized</option>
            {allCategories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.parentId ? `  ↳ ${c.name}` : c.name}
              </option>
            ))}
          </select>

          <span className="text-gray-400 text-xs">from</span>
          <input
            type="date"
            value={filterFrom}
            onChange={(e) => { setFilterFrom(e.target.value); setPage(1); }}
            className="h-[34px] rounded-lg border border-gray-200 px-2 text-xs bg-white"
          />
          <span className="text-gray-400 text-xs">to</span>
          <input
            type="date"
            value={filterTo}
            onChange={(e) => { setFilterTo(e.target.value); setPage(1); }}
            className="h-[34px] rounded-lg border border-gray-200 px-2 text-xs bg-white"
          />

          {(filterAccount || filterCategory || filterFrom || filterTo || search) && (
            <button
              onClick={() => { setSearch(''); setFilterAccount(''); setFilterCategory(''); setFilterFrom(''); setFilterTo(''); setPage(1); }}
              className="text-xs text-blue-600 hover:underline"
            >
              Clear filters
            </button>
          )}

          {total > 0 && (
            <span className="ml-auto text-xs text-gray-400">
              {total} transaction{total !== 1 ? 's' : ''}
            </span>
          )}
        </div>

        {/* Transaction table */}
        <Card padding="none">
          {isLoading ? (
            <p className="px-5 py-6 text-sm text-gray-400">Loading…</p>
          ) : items.length === 0 ? (
            <p className="px-5 py-6 text-sm text-gray-400 text-center">
              {search || filterAccount || filterCategory || filterFrom || filterTo
                ? 'No transactions match your filters.'
                : 'No transactions yet. Add one from the Accounts page or import a statement.'}
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100">
                  <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-400 uppercase tracking-wide w-20">Date</th>
                  <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-400 uppercase tracking-wide">Merchant</th>
                  <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-400 uppercase tracking-wide hidden sm:table-cell">Account</th>
                  <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-400 uppercase tracking-wide">Category</th>
                  <th className="px-4 py-2.5 text-right text-xs font-medium text-gray-400 uppercase tracking-wide">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {items.map((tx) => (
                  <>
                    <tr
                      key={tx.id}
                      className={`hover:bg-gray-50 ${!tx.categoryId ? 'bg-amber-50' : ''}`}
                    >
                      <td className="px-4 py-2.5 text-gray-500 whitespace-nowrap">
                        {formatDate(tx.postedDate)}
                      </td>
                      <td className="px-4 py-2.5 text-gray-900 font-medium max-w-[200px] truncate">
                        {tx.merchant ?? <span className="text-gray-400 italic">—</span>}
                      </td>
                      <td className="px-4 py-2.5 text-gray-500 hidden sm:table-cell">
                        {tx.accountName}
                      </td>
                      <td className="px-4 py-2.5">
                        <CategoryPill
                          name={tx.categoryName}
                          color={tx.categoryColor}
                          onClick={() => openRecat(tx)}
                        />
                      </td>
                      <td className={`px-4 py-2.5 text-right font-medium tabular-nums ${
                        tx.amountMinor >= 0 ? 'text-emerald-600' : 'text-gray-900'
                      }`}>
                        {formatAmount(tx.amountMinor, tx.currency)}
                      </td>
                    </tr>

                    {/* Recategorize panel — inline below the row */}
                    {recatTx?.id === tx.id && (
                      <tr key={`${tx.id}-recat`}>
                        <td colSpan={5} className="px-4 py-0">
                          <div className="border border-blue-100 bg-blue-50 rounded-lg px-4 py-3 mb-2 max-w-sm">
                            <p className="text-xs font-semibold text-gray-800 mb-2">
                              Recategorize · {tx.merchant ?? 'this transaction'}
                            </p>
                            <div className="space-y-2">
                              <div className="space-y-1">
                                <label className="block text-xs font-medium text-gray-600">Category</label>
                                <select
                                  value={recatCatId}
                                  onChange={(e) => setRecatCatId(e.target.value)}
                                  className="block w-full h-[32px] rounded-md border border-gray-300 px-2 text-xs bg-white"
                                >
                                  <option value="">Uncategorized</option>
                                  {allCategories.map((c) => (
                                    <option key={c.id} value={c.id}>
                                      {c.parentId ? `  ↳ ${c.name}` : c.name}
                                    </option>
                                  ))}
                                </select>
                              </div>

                              {tx.merchant && recatCatId && (
                                <label className="flex items-start gap-2 text-xs text-gray-700 cursor-pointer">
                                  <input
                                    type="checkbox"
                                    checked={recatCreateRule}
                                    onChange={(e) => setRecatCreateRule(e.target.checked)}
                                    className="mt-0.5"
                                  />
                                  <span>
                                    Always categorize <strong>{tx.merchant}</strong> as{' '}
                                    <strong>
                                      {allCategories.find((c) => c.id === recatCatId)?.name ?? '…'}
                                    </strong>
                                  </span>
                                </label>
                              )}

                              {recatError && <p className="text-xs text-red-600">{recatError}</p>}

                              <div className="flex gap-2 pt-1">
                                <button
                                  onClick={() => recatMutation.mutate()}
                                  disabled={recatMutation.isPending}
                                  className="px-3 py-1 text-xs font-medium bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
                                >
                                  Save
                                </button>
                                <button
                                  onClick={() => setRecatTx(null)}
                                  className="px-3 py-1 text-xs font-medium border border-gray-300 rounded-md hover:bg-white"
                                >
                                  Cancel
                                </button>
                              </div>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </>
                ))}
              </tbody>
            </table>
          )}
        </Card>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-center gap-2 text-sm">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
              className="px-3 py-1.5 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed text-xs"
            >
              ← Prev
            </button>
            <span className="text-xs text-gray-500">
              Page {page} of {totalPages}
            </span>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
              className="px-3 py-1.5 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed text-xs"
            >
              Next →
            </button>
          </div>
        )}

      </div>
    </NavShell>
  );
}
