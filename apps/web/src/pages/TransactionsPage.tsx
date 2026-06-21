import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Card, CategoryPicker, CategoryFilterPicker, type PickerCategory } from '@pfm/ui';
import { api, ApiException } from '../lib/api';

type Household = { id: string; name: string };
type Account = { id: string; name: string };
type Category = { id: string; name: string; color: string | null; parentId: string | null; kind?: string; children?: Category[] };

type TransferPairInfo = {
  pairId: string;
  counterpartTxId: string;
  counterpartAccountId: string;
  counterpartAccountName: string;
};

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
  isExcluded: boolean;
  externalTransfer: boolean;
  hasSplit: boolean;
  splits: Array<{ id: string; categoryId: string | null; categoryName: string | null; amountMinor: number }>;
  dedupHash: string;
  createdAt: string;
  transferPair: TransferPairInfo | null;
  awaitingCounterpartAccount: { id: string; name: string } | null;
};

type TxListResponse = {
  items: TransactionItem[];
  total: number;
  totalAmountMinor: number;
  totalExpenseMinor: number;
  totalIncomeMinor: number;
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

function toLocalDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
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
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [searchParams] = useSearchParams();

  // MTD defaults (computed once at mount, using local timezone so the date matches what the user sees)
  const defaultFrom = useMemo(() => {
    const d = new Date();
    d.setDate(1);
    return toLocalDateStr(d);
  }, []);
  const defaultTo = useMemo(() => toLocalDateStr(new Date()), []);

  // URL params pre-populate filters when navigating from the dashboard drill-down
  const initCategoryIds: string[] = useMemo(() => {
    const multi = searchParams.get('categoryIds');
    if (multi) return multi.split(',').filter(Boolean);
    const single = searchParams.get('categoryId');
    if (single && single !== 'uncategorized') return [single];
    return [];
  }, []); // intentionally empty — reads from searchParams only on mount
  const initFrom = searchParams.get('from') ?? defaultFrom;
  const initTo = searchParams.get('to') ?? defaultTo;
  const fromDashboard = searchParams.get('source') === 'dashboard';

  const { data: household } = useQuery({
    queryKey: ['household'],
    queryFn: () => api.get<Household>('/households/me'),
  });

  // ── View tab ─────────────────────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState<ViewTab>('all');

  // ── Filters ──────────────────────────────────────────────────────────────
  type QuickFilter = 'mtd' | 'ytd' | 'custom';
  const initQuickFilter: QuickFilter =
    searchParams.has('from') || searchParams.has('to') ? 'custom' : 'mtd';

  const [search, setSearch] = useState('');
  const [filterAccount, setFilterAccount] = useState('');
  const [filterCategories, setFilterCategories] = useState<string[]>(initCategoryIds);
  const [filterFrom, setFilterFrom] = useState(initFrom);
  const [filterTo, setFilterTo] = useState(initTo);
  const [quickFilter, setQuickFilter] = useState<QuickFilter>(initQuickFilter);
  const [sortBy, setSortBy] = useState<'date' | 'amount'>('date');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [page, setPage] = useState(1);
  const [hideLinked, setHideLinked] = useState(false);
  const LIMIT = 50;

  function toggleSort(field: 'date' | 'amount') {
    if (sortBy === field) {
      setSortDir((d) => (d === 'desc' ? 'asc' : 'desc'));
    } else {
      setSortBy(field);
      setSortDir(field === 'date' ? 'desc' : 'desc');
    }
    setPage(1);
  }

  function setMTD() {
    const d = new Date();
    d.setDate(1);
    setFilterFrom(toLocalDateStr(d));
    setFilterTo(toLocalDateStr(new Date()));
    setQuickFilter('mtd');
    setPage(1);
  }

  function setYTD() {
    const now = new Date();
    setFilterFrom(`${now.getFullYear()}-01-01`);
    setFilterTo(toLocalDateStr(now));
    setQuickFilter('ytd');
    setPage(1);
  }

  function buildParams(tab: ViewTab) {
    const p = new URLSearchParams();
    if (search) p.set('search', search);
    if (filterAccount) p.set('accountId', filterAccount);
    if (tab === 'uncategorized') {
      p.set('categoryId', 'uncategorized');
    } else {
      if (tab === 'categorized') p.set('hasCategory', 'true');
      if (filterCategories.length === 1) {
        p.set('categoryId', filterCategories[0]);
      } else if (filterCategories.length > 1) {
        p.set('categoryIds', filterCategories.join(','));
      }
    }
    // Don't apply date range on the Needs Review tab
    if (tab !== 'uncategorized') {
      if (filterFrom) p.set('from', filterFrom);
      if (filterTo) p.set('to', filterTo);
    }
    if (hideLinked) p.set('hideLinked', 'true');
    p.set('sortBy', sortBy);
    p.set('sortDir', sortDir);
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

  // Uncategorized count for the tab badge and nav badge
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

  // ── Per-row routing (Needs routing tab) ─────────────────────────────────
  const [routingTxId, setRoutingTxId] = useState<string | null>(null);
  const [routingSelection, setRoutingSelection] = useState<string>('');
  const [routingSubmitting, setRoutingSubmitting] = useState(false);
  const [routingError, setRoutingError] = useState('');

  async function saveRowRoute(tx: TransactionItem) {
    if (!household) return;
    setRoutingSubmitting(true);
    setRoutingError('');
    try {
      await api.post(`/households/${household.id}/transactions/transfer-routes`, [
        {
          txId: tx.id,
          sourceAccountId: tx.accountId,
          merchantMatch: tx.merchant ?? '',
          counterpartAccountId: routingSelection === 'external' ? null : routingSelection || null,
        },
      ]);
      setRoutingTxId(null);
      setRoutingSelection('');
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['transactions'] }),
        qc.invalidateQueries({ queryKey: ['accounts', household.id] }),
        qc.invalidateQueries({ queryKey: ['accounts-flat'] }),
      ]);
    } catch (err) {
      setRoutingError(err instanceof ApiException ? err.message : 'Failed to save route.');
    } finally {
      setRoutingSubmitting(false);
    }
  }

  // ── Recategorize panel ───────────────────────────────────────────────────
  const [recatTx, setRecatTx] = useState<TransactionItem | null>(null);
  const [recatCatId, setRecatCatId] = useState<string | null>(null);
  const [recatIsExcluded, setRecatIsExcluded] = useState(false);
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
    setRecatIsExcluded(tx.isExcluded);
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
    onSuccess: (updatedTx) => {
      qc.invalidateQueries({ queryKey: ['transactions'] });
      qc.invalidateQueries({ queryKey: ['transactions-uncat-count'] });
      qc.invalidateQueries({ queryKey: ['uncategorized-count'] });
      setRecatTx(null);
      // Auto-open routing panel when transaction is newly set to Transfer with no existing routing
      if (
        categoryKind(updatedTx.categoryId) === 'transfer' &&
        !updatedTx.transferPair &&
        !updatedTx.awaitingCounterpartAccount &&
        !updatedTx.externalTransfer
      ) {
        setRoutingTxId(updatedTx.id);
        setRoutingSelection('');
        setRoutingError('');
      }
    },
    onError: (err) => setRecatError(err instanceof ApiException ? err.message : 'Failed to save.'),
  });

  const excludeMutation = useMutation({
    mutationFn: ({ txId, isExcluded }: { txId: string; isExcluded: boolean }) => {
      if (!household) throw new Error('missing household');
      return api.patch(`/households/${household.id}/transactions/${txId}/exclude`, { isExcluded });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['transactions'] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (txId: string) => {
      if (!household) throw new Error('missing household');
      return api.delete(`/households/${household.id}/transactions/${txId}`);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['transactions'] });
      qc.invalidateQueries({ queryKey: ['uncategorized-count'] });
    },
  });

  function switchTab(tab: ViewTab) {
    setActiveTab(tab);
    setPage(1);
    setFilterCategories([]);
    setClassifyResult(null);
  }

  const items = txData?.items ?? [];
  const total = txData?.total ?? 0;
  const totalPages = Math.ceil(total / LIMIT);
  const totalExpenseMinor = txData?.totalExpenseMinor ?? 0;
  const totalIncomeMinor = txData?.totalIncomeMinor ?? 0;
  const categoryCurrency = items[0]?.currency ?? 'USD';

  return (
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
        <div className="flex items-center gap-1 flex-wrap">
          {([
            ['uncategorized', 'Needs review'],
            ['categorized', 'Categorized'],
            ['all', 'All'],
          ] as [ViewTab, string][]).map(([tab, label]) => (
            <button
              key={tab}
              onClick={() => switchTab(tab)}
              className="px-4 py-1.5 text-sm font-medium rounded-md transition-colors"
              style={
                activeTab === tab
                  ? { background: '#142d44', color: '#fff' }
                  : { background: 'transparent', color: '#6b7280' }
              }
              onMouseEnter={(e) => {
                if (activeTab !== tab) (e.currentTarget as HTMLElement).style.color = '#111827';
              }}
              onMouseLeave={(e) => {
                if (activeTab !== tab) (e.currentTarget as HTMLElement).style.color = '#6b7280';
              }}
            >
              {label}
              {tab === 'uncategorized' && uncatCount > 0 && (
                <span className="ml-1.5 inline-flex items-center justify-center rounded-full bg-amber-100 text-amber-700 text-xs font-semibold px-1.5 py-0.5 min-w-[1.25rem]">
                  {uncatCount}
                </span>
              )}
            </button>
          ))}

          {/* Hide linked transfers toggle — shown on All tab when not filtering by account */}
          {activeTab === 'all' && (
            <label className="ml-auto flex items-center gap-1.5 text-xs text-gray-500 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={hideLinked}
                onChange={(e) => { setHideLinked(e.target.checked); setPage(1); }}
                className="rounded"
              />
              Hide linked transfers
            </label>
          )}
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

        {/* Filter row */}
        <div className="flex flex-wrap items-center gap-2 text-sm">
          {/* Account filter */}
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

          {/* Category filter — only for categorized/all tabs */}
          {activeTab !== 'uncategorized' && (
            <CategoryFilterPicker
              categories={categories as PickerCategory[]}
              values={filterCategories}
              onChange={(ids) => { setFilterCategories(ids); setPage(1); }}
            />
          )}

          {/* Date range: MTD / YTD / Custom quick buttons */}
          <div className="flex items-center gap-1 rounded-lg bg-gray-100 p-0.5">
            <button
              type="button"
              onClick={setMTD}
              className="px-2.5 py-1 text-xs rounded-md font-medium transition-colors"
              style={quickFilter === 'mtd' ? { background: '#142d44', color: '#fff' } : {}}
            >
              MTD
            </button>
            <button
              type="button"
              onClick={setYTD}
              className="px-2.5 py-1 text-xs rounded-md font-medium transition-colors"
              style={quickFilter === 'ytd' ? { background: '#142d44', color: '#fff' } : {}}
            >
              YTD
            </button>
            <button
              type="button"
              onClick={() => setQuickFilter('custom')}
              className="px-2.5 py-1 text-xs rounded-md font-medium transition-colors"
              style={quickFilter === 'custom' ? { background: '#142d44', color: '#fff' } : {}}
            >
              Custom
            </button>
          </div>

          {/* Date inputs — only visible when Custom is selected */}
          {quickFilter === 'custom' && (
            <>
              <input
                type="date"
                value={filterFrom}
                onChange={(e) => { setFilterFrom(e.target.value); setPage(1); }}
                className="h-[34px] rounded-lg border border-gray-200 px-2 text-xs bg-white"
              />
              <span className="text-gray-400 text-xs">–</span>
              <input
                type="date"
                value={filterTo}
                onChange={(e) => { setFilterTo(e.target.value); setPage(1); }}
                className="h-[34px] rounded-lg border border-gray-200 px-2 text-xs bg-white"
              />
            </>
          )}

          {(filterAccount || filterCategories.length > 0 || search || quickFilter !== 'mtd') && (
            <button
              onClick={() => {
                setSearch('');
                setFilterAccount('');
                setFilterCategories([]);
                setFilterFrom(defaultFrom);
                setFilterTo(defaultTo);
                setQuickFilter('mtd');
                setPage(1);
              }}
              className="text-xs text-blue-600 hover:underline"
            >
              Reset
            </button>
          )}
        </div>

        {/* Sum bar — shown when data is loaded */}
        {txData && (
          <div className="flex items-center justify-between bg-gray-50 border border-gray-200 rounded-lg px-4 py-2">
            <span className="text-gray-500 text-xs">
              {total} transaction{total !== 1 ? 's' : ''}
            </span>
            <div className="flex items-center gap-4">
              {totalExpenseMinor !== 0 && (
                <span className="text-xs text-gray-500">
                  Expenses: <span className="font-semibold tabular-nums text-gray-900">{formatAmount(totalExpenseMinor, categoryCurrency)}</span>
                </span>
              )}
              {totalIncomeMinor !== 0 && (
                <span className="text-xs text-gray-500">
                  Income: <span className="font-semibold tabular-nums text-emerald-600">{formatAmount(totalIncomeMinor, categoryCurrency)}</span>
                </span>
              )}
            </div>
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
                  <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-400 uppercase tracking-wide w-24">
                    <button
                      type="button"
                      onClick={() => toggleSort('date')}
                      className="flex items-center gap-1 hover:text-gray-700 transition-colors"
                    >
                      Date
                      <span className="text-[10px] leading-none">
                        {sortBy === 'date' ? (sortDir === 'desc' ? '▼' : '▲') : '⇅'}
                      </span>
                    </button>
                  </th>
                  <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-400 uppercase tracking-wide">Merchant</th>
                  <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-400 uppercase tracking-wide hidden sm:table-cell">Account</th>
                  <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-400 uppercase tracking-wide">Category</th>
                  <th className="px-4 py-2.5 text-right text-xs font-medium text-gray-400 uppercase tracking-wide">
                    <button
                      type="button"
                      onClick={() => toggleSort('amount')}
                      className="flex items-center gap-1 ml-auto hover:text-gray-700 transition-colors"
                    >
                      <span className="text-[10px] leading-none">
                        {sortBy === 'amount' ? (sortDir === 'desc' ? '▼' : '▲') : '⇅'}
                      </span>
                      Amount
                    </button>
                  </th>
                  <th className="w-8" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {items.map((tx) => (
                  <>
                    <tr
                      key={tx.id}
                      className={`hover:bg-gray-50 ${
                        tx.isExcluded
                          ? 'opacity-50'
                          : categoryKind(tx.categoryId) === 'transfer'
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
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <CategoryPill
                              name={tx.categoryName}
                              color={tx.categoryColor}
                              onClick={() => openRecat(tx)}
                            />
                            {tx.isExcluded && (
                              <span title="Excluded from budgets & reports" className="text-gray-400 text-xs">⊘</span>
                            )}
                            {tx.transferPair && (
                              <span
                                title={`Linked to ${tx.transferPair.counterpartAccountName}`}
                                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-xs bg-emerald-50 text-emerald-700 border border-emerald-200"
                              >
                                ↔ {tx.transferPair.counterpartAccountName}
                              </span>
                            )}
                            {!tx.transferPair && tx.awaitingCounterpartAccount && (
                              <span
                                title={`Will auto-link when ${tx.awaitingCounterpartAccount.name} statement is uploaded`}
                                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-xs bg-gray-100 text-gray-500 border border-gray-200"
                              >
                                ⏳ {tx.awaitingCounterpartAccount.name}
                              </span>
                            )}
                            {!tx.transferPair && !tx.awaitingCounterpartAccount && tx.externalTransfer && (
                              <span
                                title="Transfer to/from an external account not tracked in this app"
                                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-xs bg-orange-50 text-orange-600 border border-orange-200"
                              >
                                External
                              </span>
                            )}
                          </div>
                        )}
                      </td>
                      <td className={`px-4 py-2.5 text-right font-medium tabular-nums ${
                        tx.isExcluded ? 'text-gray-400 line-through' : tx.amountMinor >= 0 ? 'text-emerald-600' : 'text-gray-900'
                      }`}>
                        {formatAmount(tx.amountMinor, tx.currency)}
                      </td>
                      <td className="px-2 py-2.5 w-20">
                        <div className="flex items-center gap-1 justify-end">
                          {/* Route button on all Transfer-category rows */}
                          {categoryKind(tx.categoryId) === 'transfer' && (
                            <button
                              title={routingTxId === tx.id
                                ? 'Cancel'
                                : (tx.transferPair || tx.awaitingCounterpartAccount || tx.externalTransfer)
                                  ? 'Change transfer routing'
                                  : 'Route this transfer'}
                              onClick={() => {
                                if (routingTxId === tx.id) {
                                  setRoutingTxId(null);
                                  setRoutingSelection('');
                                  setRoutingError('');
                                } else {
                                  setRoutingTxId(tx.id);
                                  setRoutingSelection('');
                                  setRoutingError('');
                                  setRecatTx(null);
                                }
                              }}
                              className={`text-xs px-1.5 py-0.5 rounded font-medium transition-colors ${
                                routingTxId === tx.id
                                  ? 'bg-blue-100 text-blue-700'
                                  : 'text-blue-600 hover:bg-blue-50'
                              }`}
                            >
                              {routingTxId === tx.id
                                ? 'Cancel'
                                : (tx.transferPair || tx.awaitingCounterpartAccount || tx.externalTransfer)
                                  ? 'Change'
                                  : 'Route'}
                            </button>
                          )}
                          <button
                            title="Delete transaction"
                            className="text-gray-300 hover:text-red-500 transition-colors"
                            onClick={() => {
                              if (confirm(`Delete "${tx.merchant ?? 'this transaction'}" on ${formatDate(tx.postedDate)}? This cannot be undone.`)) {
                                deleteMutation.mutate(tx.id);
                              }
                            }}
                          >
                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="w-3.5 h-3.5">
                              <path fillRule="evenodd" d="M5 3.25V4H2.75a.75.75 0 0 0 0 1.5h.3l.815 8.15A1.5 1.5 0 0 0 5.357 15h5.285a1.5 1.5 0 0 0 1.493-1.35l.815-8.15h.3a.75.75 0 0 0 0-1.5H11v-.75A2.25 2.25 0 0 0 8.75 1h-1.5A2.25 2.25 0 0 0 5 3.25Zm2.25-.75a.75.75 0 0 0-.75.75V4h3v-.75a.75.75 0 0 0-.75-.75h-1.5ZM6.05 6a.75.75 0 0 1 .787.713l.275 5.5a.75.75 0 0 1-1.498.075l-.275-5.5A.75.75 0 0 1 6.05 6Zm3.9 0a.75.75 0 0 1 .712.787l-.275 5.5a.75.75 0 0 1-1.498-.075l.275-5.5A.75.75 0 0 1 9.95 6Z" clipRule="evenodd" />
                            </svg>
                          </button>
                        </div>
                      </td>
                    </tr>

                    {/* Routing panel — inline below Transfer row */}
                    {routingTxId === tx.id && (
                      <tr key={`${tx.id}-routing`}>
                        <td colSpan={6} className="px-4 py-0">
                          <div className="border border-blue-100 bg-blue-50 rounded-lg px-4 py-3 mb-2">
                            <p className="text-xs font-semibold text-gray-800 mb-2">
                              {(tx.transferPair || tx.awaitingCounterpartAccount || tx.externalTransfer)
                                ? 'Change routing'
                                : 'Route transfer'} · {tx.merchant ?? 'this transaction'}
                            </p>
                            <p className="text-xs text-gray-500 mb-3">
                              {(tx.transferPair || tx.awaitingCounterpartAccount || tx.externalTransfer)
                                ? 'Select a new account — the existing link will be removed and this rule updated.'
                                : 'Where did this transfer come from or go to? We\'ll remember this for future imports.'}
                            </p>
                            <div className="flex flex-wrap items-center gap-2">
                              <select
                                value={routingSelection}
                                onChange={(e) => setRoutingSelection(e.target.value)}
                                className="h-[30px] rounded-md border border-gray-300 px-2 text-xs bg-white min-w-[200px]"
                              >
                                <option value="">— Select account or ignore —</option>
                                {accounts
                                  .filter((a) => a.id !== tx.accountId)
                                  .map((a) => (
                                    <option key={a.id} value={a.id}>{a.name}</option>
                                  ))}
                                <option value="external">External / not tracked (ignore)</option>
                              </select>
                              <button
                                onClick={() => saveRowRoute(tx)}
                                disabled={!routingSelection || routingSubmitting}
                                className="h-[30px] px-3 text-xs font-medium bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-40 whitespace-nowrap"
                              >
                                {routingSubmitting ? 'Saving…' : 'Save'}
                              </button>
                              <button
                                onClick={() => { setRoutingTxId(null); setRoutingSelection(''); setRoutingError(''); }}
                                className="h-[30px] px-3 text-xs text-gray-500 hover:text-gray-700"
                              >
                                Cancel
                              </button>
                            </div>
                            {routingError && <p className="text-xs text-red-600 mt-1">{routingError}</p>}
                          </div>
                        </td>
                      </tr>
                    )}

                    {/* Recategorize panel — inline below the row */}
                    {recatTx?.id === tx.id && (
                      <tr key={`${tx.id}-recat`}>
                        <td colSpan={6} className="px-4 py-0">
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

                              {/* Exclude from budgets toggle */}
                              <label className="flex items-center gap-2 text-xs text-gray-700 cursor-pointer border-t border-blue-100 pt-2">
                                <input
                                  type="checkbox"
                                  checked={recatIsExcluded}
                                  onChange={(e) => {
                                    setRecatIsExcluded(e.target.checked);
                                    excludeMutation.mutate({ txId: tx.id, isExcluded: e.target.checked });
                                  }}
                                  className="rounded"
                                />
                                <span>Exclude from budgets &amp; reports</span>
                              </label>

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
  );
}
