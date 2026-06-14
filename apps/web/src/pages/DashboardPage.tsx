import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Card, DonutChart, SpendBarChart } from '@pfm/ui';
import { api } from '../lib/api';

type Me = { id: string; email: string; name: string; isSiteAdmin: boolean };
type Household = { id: string; name: string };

type DashboardSummary = {
  netWorthMinor: number;
  currency: string;
  incomeMinor: number;
  spendingMinor: number;
  previousIncomeMinor?: number;
  previousSpendingMinor?: number;
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

type OtherItem = { id: string; name: string; color: string | null; total: number };

type DrillState =
  | { level: 'top' }
  | { level: 'category'; parentId: string; parentName: string; parentColor: string | null }
  | { level: 'other'; otherItems: OtherItem[] };

const CURRENCY_SYMBOLS: Record<string, string> = { USD: '$', EUR: '€', GBP: '£', INR: '₹' };
const TOP_N = 4;

const FALLBACK_COLORS = [
  '#6366f1', '#f59e0b', '#10b981', '#ef4444', '#3b82f6',
  '#8b5cf6', '#f97316', '#14b8a6', '#ec4899', '#84cc16',
];

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

function prevMonthName(): string {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth() - 1, 1).toLocaleString('default', { month: 'long' });
}

function greeting(name?: string): string {
  const hour = new Date().getHours();
  const time = hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : 'evening';
  const first = name?.trim().split(/\s+/)[0];
  return first ? `Good ${time}, ${first}` : `Good ${time}`;
}

function pctChange(current: number, previous: number): number {
  if (previous === 0) return 0;
  return Math.round(((current - previous) / previous) * 100);
}

export function DashboardPage() {
  const navigate = useNavigate();

  const [view, setView] = useState<'household' | 'personal'>('household');
  const [months, setMonths] = useState<3 | 6>(6);
  const [drill, setDrill] = useState<DrillState>({ level: 'top' });

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

  // Aggregate spending by top-level parent — used by top-level donut and Other drill-down
  const groupedTopLevel = useMemo(() => {
    const items = categoryQ.data ?? [];
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
    return Array.from(grouped.entries())
      .map(([id, { name, color, total }]) => ({ id, name, color, total }))
      .sort((a, b) => b.total - a.total);
  }, [categoryQ.data, catMap]);

  // Donut chart slices based on current drill state
  const donutData = useMemo(() => {
    const items = categoryQ.data ?? [];

    if (drill.level === 'category') {
      const subs = items.filter((item) => {
        if (!item.categoryId) return false;
        const info = catMap.get(item.categoryId);
        return info?.parentId === drill.parentId || item.categoryId === drill.parentId;
      });
      return subs.map((item, i) => ({
        name: item.categoryName,
        value: item.amountMinor,
        color: item.categoryColor ?? FALLBACK_COLORS[i % FALLBACK_COLORS.length],
        categoryId: item.categoryId,
        isOther: false,
      }));
    }

    if (drill.level === 'other') {
      const sorted = [...drill.otherItems].sort((a, b) => b.total - a.total);
      const top = sorted.slice(0, TOP_N);
      const rest = sorted.slice(TOP_N);
      const subOtherTotal = rest.reduce((s, x) => s + x.total, 0);
      const result = top.map((x, i) => ({
        name: x.name,
        value: x.total,
        color: x.color ?? FALLBACK_COLORS[i % FALLBACK_COLORS.length],
        categoryId: x.id === '__uncategorized__' ? null : x.id,
        isOther: false,
      }));
      if (subOtherTotal > 0) {
        result.push({ name: 'Other', value: subOtherTotal, color: '#9ca3af', categoryId: null, isOther: true });
      }
      return result;
    }

    // Top-level: top 4 + Other
    if (items.length === 0) return [];
    const top = groupedTopLevel.slice(0, TOP_N);
    const rest = groupedTopLevel.slice(TOP_N);
    const otherTotal = rest.reduce((s, x) => s + x.total, 0);
    const result = top.map((x, i) => ({
      name: x.name,
      value: x.total,
      color: x.color ?? FALLBACK_COLORS[i % FALLBACK_COLORS.length],
      categoryId: x.id === '__uncategorized__' ? null : x.id,
      isOther: false,
    }));
    if (otherTotal > 0) {
      result.push({ name: 'Other', value: otherTotal, color: '#9ca3af', categoryId: null, isOther: true });
    }
    return result;
  }, [categoryQ.data, catMap, drill, groupedTopLevel]);

  // Bar chart data
  const barData = useMemo(
    () =>
      (trendQ.data ?? []).map((item) => ({
        name: monthLabel(item.month),
        spending: item.spendingMinor,
        income: item.incomeMinor,
      })),
    [trendQ.data],
  );

  const monthStart = useMemo(() => {
    const d = new Date();
    d.setDate(1);
    return d.toISOString().slice(0, 10);
  }, []);
  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);

  function handleSliceClick(entry: { name: string; value: number; categoryId?: string | null; isOther?: boolean }) {
    const params = new URLSearchParams({ from: monthStart, to: today, source: 'dashboard' });

    if (drill.level === 'category') {
      if (entry.categoryId) params.set('categoryId', entry.categoryId);
      else params.set('categoryId', 'uncategorized');
      navigate(`/transactions?${params.toString()}`);
      return;
    }

    if (drill.level === 'other') {
      if (entry.isOther) {
        const subOtherIds = [...drill.otherItems]
          .sort((a, b) => b.total - a.total)
          .slice(TOP_N)
          .map((x) => x.id)
          .filter((id) => id !== '__uncategorized__');
        if (subOtherIds.length > 0) params.set('categoryIds', subOtherIds.join(','));
      } else {
        if (entry.categoryId) params.set('categoryId', entry.categoryId);
        else params.set('categoryId', 'uncategorized');
      }
      navigate(`/transactions?${params.toString()}`);
      return;
    }

    // Top level
    if (entry.isOther) {
      setDrill({ level: 'other', otherItems: groupedTopLevel.slice(TOP_N) });
      return;
    }

    const hasChildren = !!(categoriesQ.data ?? []).find((c) => c.id === entry.categoryId)?.children?.length;
    if (hasChildren && entry.categoryId) {
      const info = catMap.get(entry.categoryId);
      setDrill({
        level: 'category',
        parentId: entry.categoryId,
        parentName: entry.name,
        parentColor: (entry as { color?: string | null }).color ?? info?.color ?? null,
      });
    } else {
      if (entry.categoryId) params.set('categoryId', entry.categoryId);
      else params.set('categoryId', 'uncategorized');
      navigate(`/transactions?${params.toString()}`);
    }
  }

  const drillTitle =
    drill.level === 'category' ? drill.parentName :
    drill.level === 'other' ? 'Other categories' :
    'Spending by category';
  const drillSubtext =
    drill.level === 'top'
      ? `${currentMonthName()} · click a slice to drill down`
      : `${currentMonthName()} · click to view transactions`;

  return (
    <div className="p-6 space-y-6 max-w-6xl">

        {/* Topbar: greeting + view toggle */}
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-semibold text-gray-900">{greeting(me?.name)}</h1>
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
            trendCurrent={summary?.incomeMinor}
            trendPrevious={summary?.previousIncomeMinor}
            trendPositiveIsUp={true}
          />
          <KpiCard
            label={`Spending (${currentMonthName()})`}
            value={summary ? fmtMinor(summary.spendingMinor, currency) : '—'}
            loading={summaryQ.isLoading}
            color="amber"
            trendCurrent={summary?.spendingMinor}
            trendPrevious={summary?.previousSpendingMinor}
            trendPositiveIsUp={false}
          />
          <KpiCard
            label="Budget left"
            value="—"
            subtext="See Budgets"
            loading={false}
            color="gray"
          />
        </div>

        {/* Charts row — Spending Over Time LEFT, Spending by Category RIGHT */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

          {/* Spending over time — LEFT */}
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

          {/* Spending by category — RIGHT */}
          <Card padding="none">
            <div className="px-5 pt-4 pb-2">
              <div className="flex items-center gap-2">
                {drill.level !== 'top' && (
                  <button
                    onClick={() => setDrill({ level: 'top' })}
                    className="text-xs text-blue-600 hover:underline flex-shrink-0"
                  >
                    ← All
                  </button>
                )}
                <p className="text-sm font-semibold text-gray-900">{drillTitle}</p>
              </div>
              <p className="text-xs text-gray-400">{drillSubtext}</p>
            </div>
            {categoryQ.isLoading ? (
              <div className="h-64 flex items-center justify-center">
                <span className="text-sm text-gray-400">Loading…</span>
              </div>
            ) : donutData.length === 0 ? (
              <div className="h-64 flex items-center justify-center">
                <span className="text-sm text-gray-400">
                  {drill.level !== 'top' ? 'No sub-category spending' : 'No spending data this month'}
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

        </div>

      </div>
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

function KpiCard({ label, value, subtext, loading, color, trendCurrent, trendPrevious, trendPositiveIsUp }: {
  label: string;
  value: string;
  subtext?: string;
  loading: boolean;
  color: KpiColor;
  trendCurrent?: number;
  trendPrevious?: number;
  trendPositiveIsUp?: boolean;
}) {
  const { value: valueCls, dot: dotCls } = colorMap[color];

  let trendEl: React.ReactNode = null;
  if (trendCurrent !== undefined && trendPrevious !== undefined) {
    if (trendPrevious === 0) {
      trendEl = <span className="text-xs text-gray-400">No prior data</span>;
    } else {
      const pct = pctChange(trendCurrent, trendPrevious);
      const up = pct >= 0;
      const positive = trendPositiveIsUp ? up : !up;
      const arrow = up ? '▲' : '▼';
      trendEl = (
        <span className={`text-xs font-medium ${positive ? 'text-emerald-600' : 'text-red-500'}`}>
          {arrow} {Math.abs(pct)}% vs {prevMonthName()}
        </span>
      );
    }
  }

  return (
    <Card padding="md">
      <div className="space-y-2">
        <p className="text-xs text-gray-500 font-medium truncate">{label}</p>
        {loading ? (
          <div className="h-7 w-24 bg-gray-100 rounded animate-pulse" />
        ) : (
          <p className={`text-2xl font-bold tabular-nums ${valueCls}`}>{value}</p>
        )}
        {trendEl ?? (subtext ? <p className="text-xs text-gray-400">{subtext}</p> : null)}
        <div className={`h-1 w-8 rounded-full ${dotCls}`} />
      </div>
    </Card>
  );
}
