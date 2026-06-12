import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { NavShell, Card, CategoryPicker, type PickerCategory } from '@pfm/ui';
import { api, ApiException } from '../lib/api';
import { useAuth } from '../lib/auth';

type Me = { id: string; email: string; name: string; isSiteAdmin: boolean };
type Household = { id: string; name: string };
type Account = { id: string; name: string };
type Category = { id: string; name: string; color: string | null; parentId: string | null; kind?: string; children?: Category[] };

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
  hasSplit: boolean;
  splits: Array<{ id: string; categoryId: string | null; categoryName: string | null; amountMinor: number }>;
  dedupHash: string;
  createdAt: string;
};

type TxListResponse = {
  items: TransactionItem[];
  total: number;
  page: number;
  limit: number;
};

type ViewTab = 'uncategorized' | 'categorized' | 'all';

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
  const [searchParams] = useSearchParams();

  // URL params pre-populate filters when navigating from the dashboard drill-down
  const initCategory = searchParams.get('categoryId') ?? '';
  const initFrom = searchParams.get('from') ?? '';
  const initTo = searchParams.get('to') ?? '';
  const fromDashboard = searchParams.get('source') === 'dashboard';

  const { data: me } = useQuery({ queryKey: ['me'], queryFn: () => api.get<Me>('/auth/me') });
  const { data: household } = useQuery({
    queryKey: ['household'],
    queryFn: () => api.get<Household>('/households/me'),
  });

  // ── View tab ─────────────────────────────────────────────────────────────
  // If arriving from a dashboard drill-down with a category pre-selected, show "All" tab
  const [activeTab, setActiveTab] = useState<ViewTab>(initCategory ? 'all' : 'uncategorized');

  // ── Filters ──────────────────────────────────────────────────────────────
  const [search, setSearch] = useState('');
  const [filterAccount, setFilterAccount] = useState('');
  const [filterCategory, setFilterCategory] = useState(initCategory);
  const [filterFrom, setFilterFrom] = useState(initFrom);
  const [filterTo, setFilterTo] = useState(initTo);
  const [page, setPage] = useState(1);
  const LIMIT = 50;

  function buildParams(tab: ViewTab) {
    const p = new URLSearchParams();
    if (search) p.set('search', search);
    if (filterAccount) p.set('accountId', filterAccount);
    if (tab === 'uncategorized') {
      p.set('categoryId', 'uncategorized');
    } else if (tab === 'categorized') {
      p.set('hasCategory', 'true');
      if (filterCategory) p.set('categoryId', filterCategory);
    } else {
      if (filterCategory) p.set('categoryId', filterCategory);
    }
    if (filterFrom) p.set('from', filterFrom);
    if (filterTo) p.set('to', filterTo);
    p.set('page', String(page));
    p.set('limit', String(LIMIT));
    return p;
  }

  const params = buildParams(activeTab);

  const { data: txData, isLoading } = useQuery({
    queryKey: ['transactions', household?.id, params.toString()],
    queryFn: () =>
      api.get<TxListResponse>(`/households/${household!.id}/transactions?${params.toString()}`),
    enabled: !!household?.id,
  });

  // Uncategorized count for the tab badge (always fetch, small query)
  const { data: uncatData } = useQuery({
    queryKey: ['transactions-uncat-count', household?.id],
    queryFn: () =>
      api.get<TxListResponse>(`/households/${household!.id}/transactions?categoryId=uncategorized&limit=1`),
    enabled: !!household?.id,
  });
  const uncatCount = uncatData?.total ?? 0;

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

  const allCategories: Category[] = [];
  for (const p of categories) {
    allCategories.push(p);
    for (const ch of p.children ?? []) allCategories.push(ch);
  }

  function categoryKind(categoryId: string | null): string | null {
    if (!categoryId) return null;
    return allCategories.find((c) => c.id === categoryId)?.kind ?? null;
  }

  // ── Auto-classify mutation ────────────────────────────────────────────────
  const [classifyResult, setClassifyResult] = useState<{ classified: number; total: number } | null>(null);

  const classifyMutation = useMutation({
    mutationFn: () => {
      if (!household) throw new Error('missing household');
      return api.post<{ classified: number; total: number }>(
        `/households/${household.id}/transactions/apply-rules`,
        {},
      );
    },
    onSuccess: (result) => {
      setClassifyResult(result);
      qc.invalidateQueries({ queryKey: ['transactions'] });
      qc.invalidateQueries({ queryKey: ['transactions-uncat-count'] });
    },
  });

  // ── Recategorize panel ───────────────────────────────────────────────────
  const [recatTx, setRecatTx] = useState<TransactionItem | null>(null);
  const [recatCatId, setRecatCatId] = useState<string | null>(null);
  const [recatCreateRule, setRecatCreateRule] = useState(false);
  const [recatError, setRecatError] = useState('');

  const [showNewCat, setShowNewCat] = useState(false);
  const [newCatName, setNewCatName] = useState('');
  const [newCatParentId, setNewCatParentId] = useState('');
  const [newCatKind, setNewCatKind] = useState<'expense' | 'income'>('expense');
  const [newCatLoading, setNewCatLoading] = useState(false);
  const [newCatError, setNewCatError] = useState('');

  function openRecat(tx: TransactionItem) {
    setRecatTx(tx);
    setRecatCatId(tx.categoryId ?? null);
    setRecatCreateRule(false);
    setRecatError('');
    setShowNewCat(false);
    setNewCatName('');
    setNewCatParentId('');
    setNewCatKind('expense');
    setNewCatError('');
  }

  async function createCategory() {
    if (!household || !newCatName.trim()) return;
    setNewCatLoading(true);
    setNewCatError('');
    try {
      const created = await api.post<{ id: string; name: string; color: string | null; parentId: string | null }>(
        `/households/${household.id}/categories`,
        {
          name: newCatName.trim(),
          parentId: newCatParentId || null,
          kind: newCatKind,
        },
      );
      await qc.invalidateQueries({ queryKey: ['categories'] });
      setRecatCatId(created.id);
      setShowNewCat(false);
      setNewCatName('');
      setNewCatParentId('');
    } catch (err) {
      setNewCatError(err instanceof ApiException ? err.message : 'Failed to create category.');
    } finally {
      setNewCatLoading(false);
    }
  }

  const recatMutation = useMutation({
    mutationFn: () => {
      if (!household || !recatTx) throw new Error('missing');
      return api.patch<TransactionItem>(
        `/households/${household.id}/transactions/${recatTx.id}/category`,
        { categoryId: recatCatId, createRule: recatCreateRule },
      );
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['transactions'] });
      qc.invalidateQueries({ queryKey: ['transactions-uncat-count'] });
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

  function switchTab(tab: ViewTab) {
    setActiveTab(tab);
    setPage(1);
    setFilterCategory('');
    setClassifyResult(null);
  }

  const items = txData?.items ?? [];
  const total = txData?.total ?? 0;
  const totalPages = Math.ceil(total / LIMIT);

  return (
    <NavShell navItems={navItems} userEmail={me?.email ?? ''} onSignOut={handleSignOut}>
      <div className="p-6 max-w-5xl space-y-4">

        {/* Back to dashboard breadcrumb (drill-down source) */}
        {fromDashboard && (
          <button
            onClick={() => navigate('/dashboard')}
            className="text-xs text-blue-600 hover:underline"
          >
            ← Back to Dashboard
          </button>
        )}

        {/* Header */}
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

        {/* Tabs */}
        <div className="flex items-center gap-1 border-b border-gray-200">
          {([
            ['uncategorized', 'Needs review'],
            ['categorized', 'Categorized'],
            ['all', 'All'],
          ] as [ViewTab, string][]).map(([tab, label]) => (
            <button
              key={tab}
              onClick={() => switchTab(tab)}
              className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
                activeTab === tab
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              {label}
              {tab === 'uncategorized' && uncatCount > 0 && (
                <span className="ml-1.5 inline-flex items-center justify-center rounded-full bg-amber-100 text-amber-700 text-xs font-semibold px-1.5 py-0.5 min-w-[1.25rem]">
                  {uncatCount}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Uncategorized tab banner with Auto-classify */}
        {activeTab === 'uncategorized' && uncatCount > 0 && (
          <div className="flex items-center justify-between bg-amber-50 border border-amber-200 rounded-lg px-4 py-3">
            <div>
              <p className="text-sm font-medium text-amber-800">
                {uncatCount} transaction{uncatCount !== 1 ? 's' : ''} need{uncatCount === 1 ? 's' : ''} a category
              </p>
              {classifyResult && (
                <p className="text-xs text-amber-700 mt-0.5">
                  Auto-classify matched {classifyResult.classified} of {classifyResult.total} — assign the rest manually below.
                </p>
              )}
            </div>
            <button
              onClick={() => { setClassifyResult(null); classifyMutation.mutate(); }}
              disabled={classifyMutation.isPending}
              className="px-3 py-1.5 text-xs font-medium bg-amber-600 text-white rounded-md hover:bg-amber-700 disabled:opacity-50 whitespace-nowrap"
            >
              {classifyMutation.isPending ? 'Classifying…' : 'Auto-classify all'}
            </button>
          </div>
        )}

        {/* Filter row — shown only for all / categorized tabs */}
        {activeTab !== 'uncategorized' && (
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

            {activeTab === 'categorized' && (
              <select
                value={filterCategory}
                onChange={(e) => { setFilterCategory(e.target.value); setPage(1); }}
                className="h-[34px] rounded-lg border border-gray-200 px-2 text-xs bg-white text-gray-700"
              >
                <option value="">All categories</option>
                {allCategories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.parentId ? `  ↳ ${c.name}` : c.name}
                  </option>
                ))}
              </select>
            )}

            {activeTab === 'all' && (
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
            )}

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
        )}

        {/* Account filter for uncategorized tab */}
        {activeTab === 'uncategorized' && (
          <div className="flex items-center gap-2">
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
            {total > 0 && (
              <span className="ml-auto text-xs text-gray-400">
                {total} transaction{total !== 1 ? 's' : ''}
              </span>
            )}
          </div>
        )}

        {/* Transaction table */}
        <Card padding="none">
          {isLoading ? (
            <p className="px-5 py-6 text-sm text-gray-400">Loading…</p>
          ) : items.length === 0 ? (
            <p className="px-5 py-6 text-sm text-gray-400 text-center">
              {activeTab === 'uncategorized'
                ? classifyResult
                  ? `All matched transactions categorized. ${uncatCount > 0 ? `${uncatCount} still need manual review.` : 'Nothing left to review!'}`
                  : 'All transactions are categorized.'
                : 'No transactions match your filters.'}
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
                      className={`hover:bg-gray-50 ${
                        categoryKind(tx.categoryId) === 'transfer'
                          ? 'bg-gray-50 opacity-70'
                          : !tx.categoryId && !tx.hasSplit
                          ? 'bg-amber-50'
                          : ''
                      }`}
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
                        {tx.hasSplit ? (
                          <button
                            onClick={() => navigate(`/transactions/${tx.id}/split`)}
                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-violet-100 text-violet-700 hover:bg-violet-200"
                          >
                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="w-3 h-3">
                              <path fillRule="evenodd" d="M8 1a.75.75 0 0 1 .75.75V6h4.5a.75.75 0 0 1 0 1.5h-4.5v4.25a.75.75 0 0 1-1.5 0V7.5H2.75a.75.75 0 0 1 0-1.5h4.5V1.75A.75.75 0 0 1 8 1Z" clipRule="evenodd" />
                            </svg>
                            Split ({tx.splits.length})
                          </button>
                        ) : (
                          <CategoryPill
                            name={tx.categoryName}
                            color={tx.categoryColor}
                            onClick={() => openRecat(tx)}
                          />
                        )}
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
                          <div className="border border-blue-100 bg-blue-50 rounded-lg px-4 py-3 mb-2 max-w-md">
                            <p className="text-xs font-semibold text-gray-800 mb-2">
                              Recategorize · {tx.merchant ?? 'this transaction'}
                            </p>
                            <div className="space-y-2">

                              <div className="space-y-1">
                                <label className="block text-xs font-medium text-gray-600">Category</label>
                                <CategoryPicker
                                  categories={categories as PickerCategory[]}
                                  value={recatCatId}
                                  onChange={setRecatCatId}
                                />
                              </div>

                              {!showNewCat ? (
                                <button
                                  type="button"
                                  onClick={() => setShowNewCat(true)}
                                  className="text-xs text-blue-600 hover:underline"
                                >
                                  + New category
                                </button>
                              ) : (
                                <div className="border border-blue-200 bg-white rounded-md px-3 py-2.5 space-y-2">
                                  <p className="text-xs font-semibold text-gray-700">New category</p>

                                  <input
                                    type="text"
                                    placeholder="Category name"
                                    value={newCatName}
                                    onChange={(e) => setNewCatName(e.target.value)}
                                    className="block w-full h-[30px] rounded-md border border-gray-300 px-2 text-xs"
                                    autoFocus
                                  />

                                  <div className="grid grid-cols-2 gap-2">
                                    <div>
                                      <label className="block text-xs text-gray-500 mb-0.5">Sub-category of</label>
                                      <select
                                        value={newCatParentId}
                                        onChange={(e) => setNewCatParentId(e.target.value)}
                                        className="block w-full h-[30px] rounded-md border border-gray-300 px-2 text-xs bg-white"
                                      >
                                        <option value="">(top-level)</option>
                                        {categories.map((p) => (
                                          <option key={p.id} value={p.id}>{p.name}</option>
                                        ))}
                                      </select>
                                    </div>
                                    <div>
                                      <label className="block text-xs text-gray-500 mb-0.5">Type</label>
                                      <select
                                        value={newCatKind}
                                        onChange={(e) => setNewCatKind(e.target.value as 'expense' | 'income')}
                                        className="block w-full h-[30px] rounded-md border border-gray-300 px-2 text-xs bg-white"
                                        disabled={!!newCatParentId}
                                      >
                                        <option value="expense">Expense</option>
                                        <option value="income">Income</option>
                                      </select>
                                    </div>
                                  </div>

                                  {newCatError && <p className="text-xs text-red-600">{newCatError}</p>}

                                  <div className="flex gap-2">
                                    <button
                                      type="button"
                                      onClick={createCategory}
                                      disabled={!newCatName.trim() || newCatLoading}
                                      className="px-3 py-1 text-xs font-medium bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
                                    >
                                      {newCatLoading ? 'Adding…' : 'Add'}
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => { setShowNewCat(false); setNewCatName(''); setNewCatError(''); }}
                                      className="text-xs text-gray-500 hover:text-gray-700"
                                    >
                                      Cancel
                                    </button>
                                  </div>
                                </div>
                              )}

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

                              <div className="flex gap-2 pt-1 flex-wrap">
                                <button
                                  onClick={() => recatMutation.mutate()}
                                  disabled={recatMutation.isPending}
                                  className="px-3 py-1 text-xs font-medium bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
                                >
                                  Save
                                </button>
                                <button
                                  onClick={() => navigate(`/transactions/${tx.id}/split`)}
                                  className="px-3 py-1 text-xs font-medium border border-violet-300 text-violet-700 rounded-md hover:bg-violet-50"
                                >
                                  Split transaction
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
