import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { SpendBarChart, TrendLineChart } from '@pfm/ui';

// ── Types ─────────────────────────────────────────────────────────────────────

type Household = { id: string; baseCurrency: string; name: string };

type SpendingOverTimeItem = {
  month: string;
  spendingMinor: number;
  reserveSpendingMinor: number;
  taxSpendingMinor: number;
  incomeMinor: number;
};

type SpendByCatOverTime = {
  months: string[];
  categories: { categoryId: string; name: string; color: string | null; amounts: number[] }[];
};

type ComparisonRow = {
  categoryId: string;
  categoryName: string;
  period1Minor: number;
  period2Minor: number;
  deltaMinor: number;
  deltaPct: number | null;
};

type PeriodComparison = {
  period1Label: string;
  period2Label: string;
  rows: (ComparisonRow & { subRows: ComparisonRow[] })[];
  totalPeriod1Minor: number;
  totalPeriod2Minor: number;
};

type NetWorthTrendData = { points: { month: string; netWorthMinor: number }[] };

type ReportKey = 'net_worth_trend' | 'income_vs_expenses' | 'cash_flow' | 'spending_by_category';

type SavedChart = {
  id: string;
  name: string;
  chartType: string;
  measure: string;
  groupBy: string;
  dateRange: string;
  view: string;
  reportKey?: ReportKey | null;
  isShared: boolean;
};

// ── Formatting helpers ─────────────────────────────────────────────────────────

function fmtDollar(minor: number): string {
  return `$${(Math.abs(minor) / 100).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

// Takes a dollar value (not cents) — use this when data is already divided by 100
function fmtShort(dollars: number): string {
  const v = Math.abs(dollars);
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `$${(v / 1_000).toFixed(1)}k`;
  return `$${Math.round(v)}`;
}

function monthLabel(ym: string): string {
  const [y, m] = ym.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' });
}

// ── localStorage helpers for chart category selection ────────────────────────

const storageKey = (hid: string) => `pfm:chart-categories:${hid}`;

function loadSavedCategoryIds(hid: string): string[] | null {
  try {
    const v = localStorage.getItem(storageKey(hid));
    return v ? (JSON.parse(v) as string[]) : null;
  } catch { return null; }
}

function saveChartCategoryIds(hid: string, ids: string[]): void {
  localStorage.setItem(storageKey(hid), JSON.stringify(ids));
}

// ── Shared UI primitives ──────────────────────────────────────────────────────

const segBtn = (active: boolean) =>
  `px-3 py-1.5 text-xs rounded-md font-medium transition-colors ${active ? 'bg-blue-600 text-white shadow-sm' : 'text-gray-500 hover:text-gray-700'}`;

const selCls = 'rounded-lg border border-gray-300 px-2 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500';
const btnGhost = 'px-3 py-1.5 rounded-lg border border-gray-300 text-gray-700 text-sm font-medium hover:bg-gray-50 transition-colors';
const btnPrimary = 'px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors';

function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`bg-white rounded-xl border border-gray-200 shadow-sm p-5 ${className}`}>
      {children}
    </div>
  );
}

// ── Transform spending-by-category matrix → SpendBarChart format ──────────────

function matrixToBarData(data: SpendByCatOverTime): Array<{ name: string } & Record<string, string | number>> {
  return data.months.map((mk, mi) => {
    const row: { name: string } & Record<string, string | number> = { name: monthLabel(mk) };
    data.categories.forEach((cat) => {
      row[cat.categoryId] = (cat.amounts[mi] ?? 0) / 100;
    });
    return row;
  });
}

const CHART_PALETTE = ['#2E6DA4', '#E07B2C', '#2F855A', '#8e44ad', '#9CA3AF'];

function matrixToBars(data: SpendByCatOverTime) {
  return data.categories.map((cat, i) => ({
    key: cat.categoryId,
    label: cat.name,
    color: cat.categoryId === '__other__' ? '#9CA3AF' : CHART_PALETTE[i % (CHART_PALETTE.length - 1)],
    stackId: 'spend',
  }));
}

function matrixToLineData(data: SpendByCatOverTime): Array<{ name: string } & Record<string, string | number>> {
  return data.months.map((mk, mi) => {
    const row: { name: string } & Record<string, string | number> = { name: monthLabel(mk) };
    data.categories.forEach((cat) => {
      row[cat.categoryId] = (cat.amounts[mi] ?? 0) / 100;
    });
    return row;
  });
}

function matrixToLines(data: SpendByCatOverTime) {
  return data.categories.map((cat, i) => ({
    key: cat.categoryId,
    label: cat.name,
    color: cat.categoryId === '__other__' ? '#9CA3AF' : CHART_PALETTE[i % (CHART_PALETTE.length - 1)],
  }));
}

// ── Save dialog ───────────────────────────────────────────────────────────────

function SaveDialog({
  defaultName,
  householdId,
  chartConfig,
  onClose,
  onSaved,
}: {
  defaultName: string;
  householdId: string;
  chartConfig: Omit<SavedChart, 'id' | 'name'>;
  onClose: () => void;
  onSaved?: () => void;
}) {
  const qc = useQueryClient();
  const [name, setName] = useState(defaultName);
  const [isShared, setIsShared] = useState(false);
  const [saved, setSaved] = useState(false);

  const mutation = useMutation({
    mutationFn: () =>
      api.post(`/households/${householdId}/reports/saved-charts`, {
        name: name.trim() || defaultName,
        chartType: chartConfig.chartType,
        measure: chartConfig.measure,
        groupBy: chartConfig.groupBy,
        dateRange: chartConfig.dateRange,
        view: chartConfig.view,
        reportKey: chartConfig.reportKey ?? undefined,
        isShared,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['saved-charts', householdId] });
      setSaved(true);
      onSaved?.();
      setTimeout(onClose, 1500);
    },
  });

  return (
    <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/20 rounded-xl">
      <div className="bg-white rounded-xl border border-gray-200 shadow-lg p-5 w-72 space-y-3">
        <p className="text-sm font-semibold text-gray-900">Save to dashboard</p>
        <input
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Chart name"
        />
        <label className="flex items-center gap-2 text-sm text-gray-700">
          <input type="checkbox" checked={isShared} onChange={(e) => setIsShared(e.target.checked)} />
          Share with household
        </label>
        {saved ? (
          <p className="text-sm text-green-600 font-medium">Saved!</p>
        ) : (
          <div className="flex gap-2">
            <button className={btnPrimary} onClick={() => mutation.mutate()} disabled={mutation.isPending}>
              {mutation.isPending ? 'Saving…' : 'Save'}
            </button>
            <button className={btnGhost} onClick={onClose}>Cancel</button>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Controls bar ──────────────────────────────────────────────────────────────

type DateRange = '3m' | '6m' | '12m' | 'ytd';
type ViewMode = 'household' | 'personal';

function dateRangeMonths(dr: DateRange): number {
  return dr === '3m' ? 3 : dr === '6m' ? 6 : dr === 'ytd' ? new Date().getMonth() + 1 : 12;
}

// ── Category picker popover ───────────────────────────────────────────────────

type CatNode = { id: string; name: string; kind: string; parentId: string | null };

function CategoryPicker({
  householdId,
  currentlyShownIds,
  initialIds,
  onApply,
  onClose,
}: {
  householdId: string;
  currentlyShownIds: string[];
  initialIds: string[] | null;
  onApply: (ids: string[]) => void;
  onClose: () => void;
}) {
  const { data: allCats } = useQuery({
    queryKey: ['categories', householdId],
    queryFn: () => api.get<CatNode[]>(`/households/${householdId}/categories`),
  });

  const topLevel = (allCats ?? []).filter(
    (c) => c.parentId === null && c.kind === 'expense' && c.name !== 'Transfer',
  );

  const [checked, setChecked] = useState<Set<string>>(
    () => new Set(initialIds ?? currentlyShownIds),
  );

  const toggle = (id: string) =>
    setChecked((prev) => {
      const s = new Set(prev);
      s.has(id) ? s.delete(id) : s.add(id);
      return s;
    });

  return (
    <div className="absolute top-10 right-0 z-30 bg-white rounded-xl border border-gray-200 shadow-lg p-4 w-64">
      <p className="text-xs font-semibold text-gray-700 mb-2">Show categories</p>
      <div className="space-y-1.5 max-h-56 overflow-y-auto pr-1">
        {topLevel.length === 0 ? (
          <p className="text-xs text-gray-400">Loading…</p>
        ) : (
          topLevel.map((cat) => (
            <label key={cat.id} className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={checked.has(cat.id)}
                onChange={() => toggle(cat.id)}
                className="rounded"
              />
              {cat.name}
            </label>
          ))
        )}
      </div>
      <div className="flex gap-2 mt-3">
        <button className={btnPrimary} disabled={checked.size === 0} onClick={() => onApply([...checked])}>
          Apply
        </button>
        <button className={btnGhost} onClick={onClose}>Cancel</button>
      </div>
    </div>
  );
}

// ── Featured chart card ───────────────────────────────────────────────────────

function FeaturedChartCard({
  householdId,
  dateRange,
  view,
}: {
  householdId: string;
  dateRange: DateRange;
  view: ViewMode;
}) {
  const [chartMode, setChartMode] = useState<'stacked' | 'line'>('stacked');
  const [showSave, setShowSave] = useState(false);
  const [showPicker, setShowPicker] = useState(false);

  const { data: savedCharts } = useQuery({
    queryKey: ['saved-charts', householdId],
    queryFn: () => api.get<{ charts: Array<{ reportKey: string | null }> }>(`/households/${householdId}/reports/saved-charts`),
    enabled: !!householdId,
  });
  const savedToDash = (savedCharts?.charts ?? []).some((c) => c.reportKey === 'spending_by_category');
  const [selectedCategoryIds, setSelectedCategoryIds] = useState<string[] | null>(
    () => loadSavedCategoryIds(householdId),
  );

  const months = dateRangeMonths(dateRange);

  const params = new URLSearchParams({ months: String(months), view });
  if (selectedCategoryIds) params.set('categoryIds', selectedCategoryIds.join(','));

  const { data, isLoading } = useQuery({
    queryKey: ['report-cat-over-time', householdId, months, view, selectedCategoryIds],
    queryFn: () => api.get<SpendByCatOverTime>(
      `/households/${householdId}/reports/spending-by-category-over-time?${params}`,
    ),
    enabled: !!householdId,
  });

  // Derive currently-shown IDs for the picker's first-open pre-selection
  const currentlyShownIds = useMemo(
    () => data?.categories.filter((c) => c.categoryId !== '__other__').map((c) => c.categoryId) ?? [],
    [data],
  );

  const barData = useMemo(() => data ? matrixToBarData(data) : [], [data]);
  const bars = useMemo(() => data ? matrixToBars(data) : [], [data]);
  const lineData = useMemo(() => data ? matrixToLineData(data) : [], [data]);
  const lines = useMemo(() => data ? matrixToLines(data) : [], [data]);

  return (
    <Card className="relative">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-gray-900">Spending by category over time</h3>
        <div className="flex items-center gap-2">
          <div className="bg-gray-100 rounded-lg p-0.5 flex gap-0.5">
            <button className={segBtn(chartMode === 'stacked')} onClick={() => setChartMode('stacked')}>Stacked</button>
            <button className={segBtn(chartMode === 'line')} onClick={() => setChartMode('line')}>Line</button>
          </div>
          <div className="relative">
            <button
              className="text-gray-400 hover:text-gray-700 transition-colors text-3xl px-1 leading-none"
              title="Configure categories"
              onClick={() => setShowPicker((v) => !v)}
            >
              ⚙
            </button>
            {showPicker && (
              <CategoryPicker
                householdId={householdId}
                currentlyShownIds={currentlyShownIds}
                initialIds={selectedCategoryIds}
                onApply={(ids) => {
                  setSelectedCategoryIds(ids);
                  saveChartCategoryIds(householdId, ids);
                  setShowPicker(false);
                }}
                onClose={() => setShowPicker(false)}
              />
            )}
          </div>
          {savedToDash ? (
            <span className="text-xs font-medium text-green-600 flex items-center gap-1">✓ Saved</span>
          ) : (
            <button className="text-gray-400 hover:text-yellow-500 text-lg transition-colors" title="Save to dashboard" onClick={() => setShowSave(true)}>★</button>
          )}
        </div>
      </div>
      {isLoading ? (
        <div className="h-64 flex items-center justify-center text-sm text-gray-400">Loading…</div>
      ) : !data || data.categories.length === 0 ? (
        <div className="h-64 flex items-center justify-center text-sm text-gray-400">No data for this period</div>
      ) : chartMode === 'stacked' ? (
        <SpendBarChart data={barData} bars={bars} formatValue={(v) => `$${v.toLocaleString()}`} height={260} />
      ) : (
        <TrendLineChart data={lineData} lines={lines} formatValue={(v) => `$${v.toLocaleString()}`} height={260} />
      )}
      {showSave && data && (
        <SaveDialog
          defaultName="Spending by category over time"
          householdId={householdId}
          chartConfig={{ chartType: chartMode === 'stacked' ? 'stacked_bar' : 'line', measure: 'spending', groupBy: 'category', dateRange, view, reportKey: 'spending_by_category', isShared: false }}
          onClose={() => setShowSave(false)}
        />
      )}
    </Card>
  );
}

// ── Period comparison card ────────────────────────────────────────────────────

type Granularity = 'month' | 'quarter' | 'year';

function periodOptions(granularity: Granularity): string[] {
  const now = new Date();
  if (granularity === 'month') {
    const opts: string[] = [];
    for (let i = 0; i < 18; i++) {
      const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
      opts.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`);
    }
    return opts;
  }
  if (granularity === 'quarter') {
    const opts: string[] = [];
    for (let i = 0; i < 8; i++) {
      const totalMonths = now.getUTCMonth() - (i * 3);
      const y = now.getUTCFullYear() + Math.floor(totalMonths / 12);
      const q = Math.floor(((totalMonths % 12) + 12) % 12 / 3) + 1;
      opts.push(`${y}-Q${q}`);
    }
    return [...new Set(opts)];
  }
  const year = now.getUTCFullYear();
  return Array.from({ length: 5 }, (_, i) => String(year - i));
}

function periodLabel(granularity: Granularity, period: string): string {
  if (granularity === 'month') {
    const [y, m] = period.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  }
  if (granularity === 'quarter') return period.replace('-', ' ');
  return period;
}

function DeltaCell({ row }: { row: ComparisonRow }) {
  const up = row.deltaMinor > 0;
  const none = row.deltaMinor === 0;
  return (
    <td className={`py-2 text-right font-medium ${none ? 'text-gray-400' : up ? 'text-red-600' : 'text-green-600'}`}>
      {none ? '—' : `${up ? '▲' : '▼'} ${fmtDollar(Math.abs(row.deltaMinor))}${row.deltaPct !== null ? ` · ${up ? '+' : ''}${row.deltaPct}%` : ''}`}
    </td>
  );
}

function PeriodComparisonCard({ householdId, view }: { householdId: string; view: ViewMode }) {
  const [gran, setGran] = useState<Granularity>('month');
  const opts = useMemo(() => periodOptions(gran), [gran]);
  const [period1, setPeriod1] = useState(() => periodOptions('month')[1]);
  const [period2, setPeriod2] = useState(() => periodOptions('month')[0]);
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const [showAll, setShowAll] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['period-comparison', householdId, gran, period1, period2, view],
    queryFn: () =>
      api.get<PeriodComparison>(
        `/households/${householdId}/reports/period-comparison?granularity=${gran}&period1=${period1}&period2=${period2}&view=${view}`,
      ),
    enabled: !!householdId && !!period1 && !!period2,
  });

  function handleGranChange(g: Granularity) {
    setGran(g);
    const newOpts = periodOptions(g);
    setPeriod1(newOpts[1] ?? newOpts[0]);
    setPeriod2(newOpts[0]);
    setExpandedRows(new Set());
    setShowAll(false);
  }

  function toggleExpand(catId: string) {
    setExpandedRows((prev) => {
      const next = new Set(prev);
      if (next.has(catId)) next.delete(catId);
      else next.add(catId);
      return next;
    });
  }

  const visibleRows = data ? (showAll ? data.rows : data.rows.slice(0, 5)) : [];

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <h3 className="text-sm font-semibold text-gray-900">Period comparison — spending by category</h3>
        <div className="bg-gray-100 rounded-lg p-0.5 flex gap-0.5">
          {(['month', 'quarter', 'year'] as Granularity[]).map((g) => (
            <button key={g} className={segBtn(gran === g)} onClick={() => handleGranChange(g)}>
              {g === 'month' ? 'Month vs month' : g === 'quarter' ? 'Quarter vs quarter' : 'Year vs year'}
            </button>
          ))}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <select className={selCls} value={period1} onChange={(e) => setPeriod1(e.target.value)}>
          {opts.map((o) => <option key={o} value={o}>{periodLabel(gran, o)}</option>)}
        </select>
        <span className="text-sm text-gray-400">compared with</span>
        <select className={selCls} value={period2} onChange={(e) => setPeriod2(e.target.value)}>
          {opts.map((o) => <option key={o} value={o}>{periodLabel(gran, o)}</option>)}
        </select>
      </div>

      {isLoading ? (
        <div className="py-8 text-center text-sm text-gray-400">Loading…</div>
      ) : !data || data.rows.length === 0 ? (
        <div className="py-8 text-center text-sm text-gray-400">No data for the selected periods</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100">
                <th className="text-left pb-2 text-gray-500 font-medium">Category</th>
                <th className="text-right pb-2 text-gray-500 font-medium">{data.period1Label}</th>
                <th className="text-right pb-2 text-gray-500 font-medium">{data.period2Label}</th>
                <th className="text-right pb-2 text-gray-500 font-medium">Change</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {visibleRows.map((row) => {
                const hasChildren = row.subRows.length > 0;
                const expanded = expandedRows.has(row.categoryId);
                return (
                  <>
                    <tr
                      key={row.categoryId}
                      className={`hover:bg-gray-50 ${hasChildren ? 'cursor-pointer' : ''}`}
                      onClick={hasChildren ? () => toggleExpand(row.categoryId) : undefined}
                    >
                      <td className="py-2 text-gray-900 flex items-center gap-1.5">
                        {hasChildren ? (
                          <span className="text-gray-500 text-lg w-5 shrink-0">{expanded ? '▾' : '▸'}</span>
                        ) : (
                          <span className="w-3 shrink-0" />
                        )}
                        <span className="font-medium">{row.categoryName}</span>
                      </td>
                      <td className="py-2 text-right text-gray-600">{fmtDollar(row.period1Minor)}</td>
                      <td className="py-2 text-right text-gray-600">{fmtDollar(row.period2Minor)}</td>
                      <DeltaCell row={row} />
                    </tr>
                    {expanded && row.subRows.map((sub) => (
                      <tr key={sub.categoryId} className="bg-gray-50/70">
                        <td className="py-1.5 pl-8 text-gray-600 flex items-center gap-1.5">
                          <span className="w-3 shrink-0" />
                          {sub.categoryName}
                        </td>
                        <td className="py-1.5 text-right text-gray-500 text-xs">{fmtDollar(sub.period1Minor)}</td>
                        <td className="py-1.5 text-right text-gray-500 text-xs">{fmtDollar(sub.period2Minor)}</td>
                        <DeltaCell row={sub} />
                      </tr>
                    ))}
                  </>
                );
              })}
              {!showAll && data.rows.length > 5 && (
                <tr>
                  <td colSpan={4} className="pt-2 pb-1">
                    <button
                      className="text-sm text-blue-600 hover:text-blue-800 hover:underline"
                      onClick={() => setShowAll(true)}
                    >
                      Show {data.rows.length - 5} more categories
                    </button>
                  </td>
                </tr>
              )}
              <tr className="border-t border-gray-200 font-semibold">
                <td className="pt-3 pl-4 text-gray-900">Total</td>
                <td className="pt-3 text-right text-gray-900">{fmtDollar(data.totalPeriod1Minor)}</td>
                <td className="pt-3 text-right text-gray-900">{fmtDollar(data.totalPeriod2Minor)}</td>
                <td className={`pt-3 text-right ${data.totalPeriod2Minor > data.totalPeriod1Minor ? 'text-red-600' : 'text-green-600'}`}>
                  {data.totalPeriod2Minor === data.totalPeriod1Minor ? '—' :
                    `${data.totalPeriod2Minor > data.totalPeriod1Minor ? '▲' : '▼'} ${fmtDollar(Math.abs(data.totalPeriod2Minor - data.totalPeriod1Minor))}`}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
      <p className="text-xs text-gray-400 mt-3">Click any category to expand subcategories. Only includes accounts you can see.</p>
    </Card>
  );
}

// ── Report library mini-cards ─────────────────────────────────────────────────

function MiniCard({
  title,
  householdId,
  children,
  chartConfig,
}: {
  title: string;
  householdId: string;
  children: React.ReactNode;
  chartConfig: Omit<SavedChart, 'id' | 'name'>;
}) {
  const [showSave, setShowSave] = useState(false);

  const { data: savedCharts } = useQuery({
    queryKey: ['saved-charts', householdId],
    queryFn: () => api.get<{ charts: Array<{ reportKey: string | null }> }>(`/households/${householdId}/reports/saved-charts`),
    enabled: !!householdId,
  });
  const savedToDash = chartConfig.reportKey != null &&
    (savedCharts?.charts ?? []).some((c) => c.reportKey === chartConfig.reportKey);

  return (
    <div className="relative">
      <Card>
        <div className="flex items-center justify-between mb-2">
          <h4 className="text-xs font-semibold text-gray-700">{title}</h4>
          {savedToDash ? (
            <span className="text-xs font-medium text-green-600 flex items-center gap-1">✓ Saved</span>
          ) : (
            <button
              className="text-gray-300 hover:text-yellow-500 text-sm transition-colors"
              title="Save to dashboard"
              onClick={() => setShowSave(true)}
            >★</button>
          )}
        </div>
        {children}
      </Card>
      {showSave && (
        <SaveDialog
          defaultName={title}
          householdId={householdId}
          chartConfig={chartConfig}
          onClose={() => setShowSave(false)}
        />
      )}
    </div>
  );
}

function IncomeVsExpensesCard({ householdId, dateRange, view }: { householdId: string; dateRange: DateRange; view: ViewMode }) {
  const months = dateRangeMonths(dateRange);
  const { data } = useQuery({
    queryKey: ['spending-over-time', householdId, months, view],
    queryFn: () => api.get<SpendingOverTimeItem[]>(`/households/${householdId}/dashboard/spending-over-time?months=${months}&view=${view}`),
    enabled: !!householdId,
  });

  const barData = useMemo(
    () => (data ?? []).map((item) => ({
      name: monthLabel(item.month),
      income: item.incomeMinor / 100,
      spending: (item.spendingMinor + item.reserveSpendingMinor + item.taxSpendingMinor) / 100,
    })),
    [data],
  );

  return (
    <MiniCard title="Income vs. expenses" householdId={householdId} chartConfig={{ chartType: 'bar', measure: 'spending', groupBy: 'month', dateRange, view, reportKey: 'income_vs_expenses', isShared: false }}>
      <SpendBarChart
        data={barData}
        bars={[
          { key: 'income', label: 'Income', color: '#2F855A' },
          { key: 'spending', label: 'Spending', color: '#c0392b' },
        ]}
        formatValue={fmtShort}
        height={130}
      />
    </MiniCard>
  );
}

function NetWorthCard({ householdId, dateRange }: { householdId: string; dateRange: DateRange }) {
  const months = dateRangeMonths(dateRange);
  const { data } = useQuery({
    queryKey: ['net-worth-trend', householdId, months],
    queryFn: () => api.get<NetWorthTrendData>(`/households/${householdId}/reports/net-worth-trend?months=${months}`),
    enabled: !!householdId,
  });

  const lineData = useMemo(
    () => (data?.points ?? []).map((p) => ({ name: monthLabel(p.month), netWorth: p.netWorthMinor / 100 })),
    [data],
  );

  return (
    <MiniCard title="Net worth trend" householdId={householdId} chartConfig={{ chartType: 'line', measure: 'spending', groupBy: 'month', dateRange, view: 'household', reportKey: 'net_worth_trend', isShared: false }}>
      <TrendLineChart
        data={lineData}
        lines={[{ key: 'netWorth', label: 'Net worth', color: '#2E6DA4' }]}
        formatValue={fmtShort}
        height={130}
        showLegend={false}
      />
    </MiniCard>
  );
}

function CashFlowCard({ householdId, dateRange, view }: { householdId: string; dateRange: DateRange; view: ViewMode }) {
  const months = dateRangeMonths(dateRange);
  const { data } = useQuery({
    queryKey: ['spending-over-time', householdId, months, view],
    queryFn: () => api.get<SpendingOverTimeItem[]>(`/households/${householdId}/dashboard/spending-over-time?months=${months}&view=${view}`),
    enabled: !!householdId,
  });

  const barData = useMemo(
    () => (data ?? []).map((item) => ({
      name: monthLabel(item.month),
      cashFlow: (item.incomeMinor - item.spendingMinor - item.reserveSpendingMinor - item.taxSpendingMinor) / 100,
    })),
    [data],
  );

  return (
    <MiniCard title="Cash flow" householdId={householdId} chartConfig={{ chartType: 'bar', measure: 'income', groupBy: 'month', dateRange, view, reportKey: 'cash_flow', isShared: false }}>
      <SpendBarChart
        data={barData}
        bars={[{ key: 'cashFlow', label: 'Cash flow', colorByValue: (v) => v < 0 ? '#e53e3e' : '#16a085' }]}
        formatValue={fmtShort}
        height={130}
        showLegend={false}
      />
    </MiniCard>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export function ReportsPage() {
  const [dateRange, setDateRange] = useState<DateRange>('6m');
  const [view, setView] = useState<ViewMode>('household');

  const { data: household } = useQuery({
    queryKey: ['household'],
    queryFn: () => api.get<Household>('/households/me'),
  });

  const hid = household?.id;

  const dateRangeLabel: Record<DateRange, string> = {
    '3m': 'Last 3 months',
    '6m': 'Last 6 months',
    '12m': 'Last 12 months',
    ytd: 'This year',
  };

  if (!hid) {
    return <div className="text-sm text-gray-400 p-6">Loading…</div>;
  }

  return (
    <div className="space-y-5 max-w-6xl">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Reports</h1>
      </div>

      {/* Controls */}
      <Card className="flex flex-wrap items-center gap-3 !p-3">
        <span className="text-xs text-gray-400">Showing:</span>
        <select className={selCls} value={dateRange} onChange={(e) => setDateRange(e.target.value as DateRange)}>
          {(Object.keys(dateRangeLabel) as DateRange[]).map((dr) => (
            <option key={dr} value={dr}>{dateRangeLabel[dr]}</option>
          ))}
        </select>
        <div className="bg-gray-100 rounded-lg p-0.5 flex gap-0.5">
          <button className={segBtn(view === 'household')} onClick={() => setView('household')}>Household</button>
          <button className={segBtn(view === 'personal')} onClick={() => setView('personal')}>Personal</button>
        </div>
      </Card>

      {/* Featured chart */}
      <FeaturedChartCard householdId={hid} dateRange={dateRange} view={view} />

      {/* Period comparison */}
      <PeriodComparisonCard householdId={hid} view={view} />

      {/* Report library */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-base font-semibold text-gray-900">Report library</h2>
          <span className="text-xs text-gray-400">★ save to dashboard</span>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <IncomeVsExpensesCard householdId={hid} dateRange={dateRange} view={view} />
          <NetWorthCard householdId={hid} dateRange={dateRange} />
          <CashFlowCard householdId={hid} dateRange={dateRange} view={view} />
        </div>
      </div>
    </div>
  );
}
