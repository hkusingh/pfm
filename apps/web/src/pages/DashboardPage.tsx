import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { NavShell, Card, DonutChart, SpendBarChart } from '@pfm/ui';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';

type Me = { id: string; email: string; name: string; isSiteAdmin: boolean };
type Household = { id: string; name: string };

type DashboardSummary = {
  netWorthMinor: number;
  currency: string;
  incomeMinor: number;
  spendingMinor: number;
  from: string;
  to: string;
};

type SpendingByCategoryItem = {
  categoryId: string | null;
  categoryName: string;
  categoryColor: string | null;
  amountMinor: number;
};

type SpendingOverTimeItem = {
  month: string;
  spendingMinor: number;
  incomeMinor: number;
};

type Category = {
  id: string;
  name: string;
  color: string | null;
  parentId: string | null;
  children?: Category[];
};

const CURRENCY_SYMBOLS: Record<string, string> = { USD: '$', EUR: '€', GBP: '£', INR: '₹' };

function fmtMinor(minor: number, currency: string): string {
  const symbol = CURRENCY_SYMBOLS[currency] ?? currency + ' ';
  return `${symbol}${(Math.abs(minor) / 100).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

function fmtMinorShort(minor: number): string {
  const abs = Math.abs(minor) / 100;
  if (abs >= 1_000_000) return `$${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `$${(abs / 1_000).toFixed(1)}K`;
  return `$${abs.toFixed(0)}`;
}

function monthLabel(yyyyMM: string): string {
  const [y, m] = yyyyMM.split('-');
  return new Date(parseInt(y), parseInt(m) - 1, 1).toLocaleString('default', { month: 'short' });
}

function currentMonthName(): string {
  return new Date().toLocaleString('default', { month: 'long', year: 'numeric' });
}

const FALLBACK_COLORS = [
  '#6366f1', '#f59e0b', '#10b981', '#ef4444', '#3b82f6',
  '#8b5cf6', '#f97316', '#14b8a6', '#ec4899', '#84cc16',
];

export function DashboardPage() {
  const { clearTokens } = useAuth();
  const navigate = useNavigate();

  const [view, setView] = useState<'household' | 'personal'>('household');
  const [months, setMonths] = useState<3 | 6>(6);
  const [drillParent, setDrillParent] = useState<{ id: string; name: string; color: string | null } | null>(null);

  const { data: me } = useQuery({ queryKey: ['me'], queryFn: () => api.get<Me>('/auth/me') });
  const { data: household, isError: noHousehold } = useQuery({
    queryKey: ['household'],
    queryFn: () => api.get<Household>('/households/me'),
    retry: false,
  });

  useEffect(() => {
    if (noHousehold) navigate('/onboarding/household', { replace: true });
  }, [noHousehold, navigate]);

  const hid = household?.id;

  const summaryQ = useQuery({
    queryKey: ['dashboard-summary', hid, view],
    queryFn: () => api.get<DashboardSummary>(`/households/${hid}/dashboard/summary?view=${view}`),
    enabled: !!hid,
  });

  const categoryQ = useQuery({
    queryKey: ['dashboard-by-category', hid, view],
    queryFn: () => api.get<SpendingByCategoryItem[]>(`/households/${hid}/dashboard/spending-by-category?view=${view}`),
    enabled: !!hid,
  });

  const trendQ = useQuery({
    queryKey: ['dashboard-over-time', hid, view, months],
    queryFn: () => api.get<SpendingOverTimeItem[]>(`/households/${hid}/dashboard/spending-over-time?view=${view}&months=${months}`),
    enabled: !!hid,
  });

  const categoriesQ = useQuery({
    queryKey: ['categories', hid],
    queryFn: () => api.get<Category[]>(`/households/${hid}/categories`),
    enabled: !!hid,
  });

  const summary = summaryQ.data;
  const currency = summary?.currency ?? 'USD';

  // Build category lookup: id → { parentId, name, color }
  const catMap = useMemo(() => {
    const m = new Map<string, { parentId: string | null; name: string; color: string | null }>();
    for (const c of categoriesQ.data ?? []) {
      m.set(c.id, { parentId: null, name: c.name, color: c.color });
      for (const ch of c.children ?? []) {
        m.set(ch.id, { parentId: c.id, name: ch.name, color: ch.color });
      }
    }
    return m;
  }, [categoriesQ.data]);

  // Donut chart data with top-5 + Other grouping
  const donutData = useMemo(() => {
    const items = categoryQ.data ?? [];
    if (items.length === 0) return [];

    if (drillParent) {
      // Drill-down: show all spending items that belong to this top-level parent
      // (items whose own parentId matches, plus items that ARE the parent directly)
      const subs = items.filter((item) => {
        if (!item.categoryId) return false;
        const info = catMap.get(item.categoryId);
        return info?.parentId === drillParent.id || item.categoryId === drillParent.id;
      });
      return subs.map((item, i) => ({
        name: item.categoryName,
        value: item.amountMinor,
        color: item.categoryColor ?? FALLBACK_COLORS[i % FALLBACK_COLORS.length],
        categoryId: item.categoryId,
        isOther: false,
      }));
    }

    // Top-level view: aggregate spending by top-level parent
    const grouped = new Map<string, { name: string; color: string | null; total: number }>();

    for (const item of items) {
      const info = item.categoryId ? catMap.get(item.categoryId) : null;
      const topId = info?.parentId ?? item.categoryId ?? '__uncategorized__';
      const topName = info?.parentId
        ? (catMap.get(info.parentId)?.name ?? item.categoryName)
        : (item.categoryName ?? 'Uncategorized');
      const topColor = info?.parentId
        ? (catMap.get(info.parentId)?.color ?? null)
        : item.categoryColor;

      const entry = grouped.get(topId) ?? { name: topName, color: topColor, total: 0 };
      entry.total += item.amountMinor;
      grouped.set(topId, entry);
    }

    const sorted = Array.from(grouped.entries())
      .map(([id, { name, color, total }]) => ({ id, name, color, total }))
      .sort((a, b) => b.total - a.total);

    const TOP_N = 5;
    const top = sorted.slice(0, TOP_N);
    const rest = sorted.slice(TOP_N);
    const otherTotal = rest.reduce((s, x) => s + x.total, 0);

    const result = top.map((x, i) => ({
      name: x.name,
      value: x.total,
      color: x.color ?? FALLBACK_COLORS[i % FALLBACK_COLORS.length],
      categoryId: x.id === '__uncategorized__' ? null : x.id,
      isOther: false,
    }));

    if (otherTotal > 0) {
      result.push({
        name: 'Other',
        value: otherTotal,
        color: '#9ca3af',
        categoryId: null,
        isOther: true,
      });
    }

    return result;
  }, [categoryQ.data, catMap, drillParent]);

  // Bar chart data
  const barData = useMemo(
    () =>
      (trendQ.data ?? []).map((item) => ({
        name: monthLabel(item.month),
        spending: item.spendingMinor / 100,
        income: item.incomeMinor / 100,
      })),
    [trendQ.data],
  );

  function handleSliceClick(entry: { name: string; value: number; categoryId?: string | null; isOther?: boolean }) {
    if (drillParent) {
      // In drill-down: click navigates to filtered transactions
      const from = new Date();
      from.setDate(1);
      const fromStr = from.toISOString().slice(0, 10);
      const toStr = new Date().toISOString().slice(0, 10);
      const params = new URLSearchParams({ from: fromStr, to: toStr, source: 'dashboard' });
      if (entry.categoryId) params.set('categoryId', entry.categoryId);
      else params.set('categoryId', 'uncategorized');
      navigate(`/transactions?${params.toString()}`);
    } else if (entry.isOther) {
      // Other slice: navigate to all transactions this month
      const from = new Date();
      from.setDate(1);
      const fromStr = from.toISOString().slice(0, 10);
      const toStr = new Date().toISOString().slice(0, 10);
      navigate(`/transactions?from=${fromStr}&to=${toStr}&source=dashboard`);
    } else {
      // Top-level category: drill down to show sub-categories
      const info = entry.categoryId ? catMap.get(entry.categoryId) : null;
      const hasChildren = !!(categoriesQ.data ?? []).find((c) => c.id === entry.categoryId)?.children?.length;
      if (hasChildren || info === undefined) {
        // Has sub-categories — drill down
        setDrillParent({ id: entry.categoryId ?? '', name: entry.name, color: (entry as { color?: string | null }).color ?? null });
      } else {
        // Leaf category — navigate directly to transactions
        const from = new Date();
        from.setDate(1);
        const fromStr = from.toISOString().slice(0, 10);
        const toStr = new Date().toISOString().slice(0, 10);
        const params = new URLSearchParams({ from: fromStr, to: toStr, source: 'dashboard' });
        if (entry.categoryId) params.set('categoryId', entry.categoryId);
        navigate(`/transactions?${params.toString()}`);
      }
    }
  }

  const navItems = [
    { label: 'Dashboard', href: '/dashboard', active: true },
    { label: 'Transactions', href: '/transactions', active: false },
    { label: 'Accounts', href: '/accounts', active: false },
    { label: 'Categories', href: '/categories', active: false },
    { label: 'Household', href: '/settings/household', active: false },
    ...(me?.isSiteAdmin ? [{ label: 'Admin', href: '/admin', active: false }] : []),
  ];

  async function handleSignOut() {
    const refreshToken = localStorage.getItem('refreshToken');
    if (refreshToken) api.post('/auth/logout', { refreshToken }).catch(() => undefined);
    clearTokens();
    navigate('/login');
  }

  return (
    <NavShell navItems={navItems} userEmail={me?.email ?? ''} onSignOut={handleSignOut}>
      <div className="p-6 space-y-6 max-w-6xl">

        {/* Header + view toggle */}
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold text-gray-900">Dashboard</h1>
          <div className="flex items-center gap-1 rounded-lg bg-gray-100 p-1">
            <button
              onClick={() => setView('household')}
              className={`px-3 py-1.5 text-xs rounded-md font-medium transition-colors ${view === 'household' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
            >
              Household
            </button>
            <button
              onClick={() => setView('personal')}
              className={`px-3 py-1.5 text-xs rounded-md font-medium transition-colors ${view === 'personal' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
            >
              Personal
            </button>
          </div>
        </div>

        {/* KPI cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <KpiCard
            label="Net worth"
            value={summary ? fmtMinor(summary.netWorthMinor, currency) : '—'}
            loading={summaryQ.isLoading}
            color={!summary || summary.netWorthMinor >= 0 ? 'emerald' : 'red'}
          />
          <KpiCard
            label={`Income (${currentMonthName()})`}
            value={summary ? fmtMinor(summary.incomeMinor, currency) : '—'}
            loading={summaryQ.isLoading}
            color="blue"
          />
          <KpiCard
            label={`Spending (${currentMonthName()})`}
            value={summary ? fmtMinor(summary.spendingMinor, currency) : '—'}
            loading={summaryQ.isLoading}
            color="amber"
          />
          <KpiCard
            label="Budget left"
            value="—"
            subtext="Available after Epic 6"
            loading={false}
            color="gray"
          />
        </div>

        {/* Charts row */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

          {/* Spending by category */}
          <Card padding="none">
            <div className="px-5 pt-4 pb-2 flex items-center justify-between">
              <div>
                <div className="flex items-center gap-2">
                  {drillParent && (
                    <button
                      onClick={() => setDrillParent(null)}
                      className="text-xs text-blue-600 hover:underline"
                    >
                      ← All
                    </button>
                  )}
                  <p className="text-sm font-semibold text-gray-900">
                    {drillParent ? drillParent.name : 'Spending by category'}
                  </p>
                </div>
                <p className="text-xs text-gray-400">
                  {currentMonthName()}
                  {drillParent ? ' · click to view transactions' : ' · click a slice to drill down'}
                </p>
              </div>
            </div>
            {categoryQ.isLoading ? (
              <div className="h-64 flex items-center justify-center">
                <span className="text-sm text-gray-400">Loading…</span>
              </div>
            ) : donutData.length === 0 ? (
              <div className="h-64 flex items-center justify-center">
                <span className="text-sm text-gray-400">
                  {drillParent ? 'No sub-category spending' : 'No spending data this month'}
                </span>
              </div>
            ) : (
              <DonutChart
                data={donutData}
                formatValue={(v) => fmtMinorShort(v)}
                height={280}
                onSliceClick={handleSliceClick}
              />
            )}
          </Card>

          {/* Spending over time */}
          <Card padding="none">
            <div className="px-5 pt-4 pb-2 flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold text-gray-900">Spending over time</p>
                <p className="text-xs text-gray-400">Monthly income vs spending</p>
              </div>
              <div className="flex items-center gap-1 rounded-lg bg-gray-100 p-0.5">
                <button
                  onClick={() => setMonths(3)}
                  className={`px-2.5 py-1 text-xs rounded-md font-medium transition-colors ${months === 3 ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
                >
                  3M
                </button>
                <button
                  onClick={() => setMonths(6)}
                  className={`px-2.5 py-1 text-xs rounded-md font-medium transition-colors ${months === 6 ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
                >
                  6M
                </button>
              </div>
            </div>
            {trendQ.isLoading ? (
              <div className="h-64 flex items-center justify-center">
                <span className="text-sm text-gray-400">Loading…</span>
              </div>
            ) : (
              <div className="px-2 pb-4">
                <SpendBarChart
                  data={barData}
                  bars={[
                    { key: 'income', label: 'Income', color: '#10b981' },
                    { key: 'spending', label: 'Spending', color: '#f59e0b' },
                  ]}
                  formatValue={fmtMinorShort}
                  height={260}
                />
              </div>
            )}
          </Card>
        </div>

      </div>
    </NavShell>
  );
}

// ─── KPI card ─────────────────────────────────────────────────────────────────

type KpiColor = 'emerald' | 'blue' | 'amber' | 'red' | 'gray';

const colorMap: Record<KpiColor, { value: string; dot: string }> = {
  emerald: { value: 'text-emerald-600', dot: 'bg-emerald-400' },
  blue:    { value: 'text-blue-600',    dot: 'bg-blue-400' },
  amber:   { value: 'text-amber-600',   dot: 'bg-amber-400' },
  red:     { value: 'text-red-600',     dot: 'bg-red-400' },
  gray:    { value: 'text-gray-400',    dot: 'bg-gray-300' },
};

function KpiCard({ label, value, subtext, loading, color }: {
  label: string;
  value: string;
  subtext?: string;
  loading: boolean;
  color: KpiColor;
}) {
  const { value: valueCls, dot: dotCls } = colorMap[color];
  return (
    <Card padding="md">
      <div className="space-y-2">
        <p className="text-xs text-gray-500 font-medium truncate">{label}</p>
        {loading ? (
          <div className="h-7 w-24 bg-gray-100 rounded animate-pulse" />
        ) : (
          <p className={`text-2xl font-bold tabular-nums ${valueCls}`}>{value}</p>
        )}
        {subtext && <p className="text-xs text-gray-400">{subtext}</p>}
        <div className={`h-1 w-8 rounded-full ${dotCls}`} />
      </div>
    </Card>
  );
}
