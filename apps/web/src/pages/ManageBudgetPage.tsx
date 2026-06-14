import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Card, Button, Badge } from '@pfm/ui';
import { api, ApiException } from '../lib/api';
import type {
  BudgetSummaryItem,
  BudgetSummaryResponse,
  SinkingFundResponse,
  SinkingFundCadence,
  SinkingFundMethod,
  SinkingFundStartMode,
} from '@pfm/contracts';

type Household = { id: string; name: string };
type Category = { id: string; name: string; kind: 'expense' | 'income' | 'transfer'; children?: Category[] };

const CURRENCY_SYMBOLS: Record<string, string> = { USD: '$', EUR: '€', GBP: '£', INR: '₹' };
const DEFAULT_BUDGET_PERIOD = '__default__';
const EXPENSE_VISIBLE_COUNT = 5;

function fmtMinor(minor: number, currency: string): string {
  const symbol = CURRENCY_SYMBOLS[currency] ?? currency + ' ';
  return `${symbol}${(Math.abs(minor) / 100).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

function minorToInputOrEmpty(minor: number): string {
  return minor === 0 ? '' : (minor / 100).toFixed(2);
}

function inputToMinor(value: string): number {
  const n = Math.round(parseFloat(value || '0') * 100);
  return Number.isFinite(n) ? n : 0;
}

// ─── Chevron ─────────────────────────────────────────────────────────────────

function Chevron({ expanded }: { expanded: boolean }) {
  return (
    <span
      className="w-5 h-5 flex items-center justify-center rounded text-gray-400 hover:text-gray-700 hover:bg-gray-100 flex-shrink-0"
      style={{ transform: expanded ? 'rotate(0deg)' : 'rotate(-90deg)', transition: 'transform 150ms' }}
    >
      <svg width="12" height="12" viewBox="0 0 14 14" fill="none">
        <path d="M3 5l4 4 4-4" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export function ManageBudgetPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();

  const { data: household } = useQuery({
    queryKey: ['household'],
    queryFn: () => api.get<Household>('/households/me'),
  });
  const hid = household?.id;

  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [showAll, setShowAll] = useState(false);

  // Fetch default budget amounts using __default__ period
  const summaryQ = useQuery({
    queryKey: ['budget-summary', hid, DEFAULT_BUDGET_PERIOD],
    queryFn: () => api.get<BudgetSummaryResponse>(`/households/${hid}/budgets?period=${DEFAULT_BUDGET_PERIOD}`),
    enabled: !!hid,
  });

  const sinkingFundsQ = useQuery({
    queryKey: ['sinking-funds', hid],
    queryFn: () => api.get<SinkingFundResponse[]>(`/households/${hid}/sinking-funds`),
    enabled: !!hid,
  });

  const categoriesQ = useQuery({
    queryKey: ['categories', hid],
    queryFn: () => api.get<Category[]>(`/households/${hid}/categories`),
    enabled: !!hid,
  });

  const currency = summaryQ.data?.currency ?? 'USD';

  const upsertMutation = useMutation({
    mutationFn: (vars: { categoryId: string; amountMinor: number }) =>
      api.put(`/households/${hid}/budgets`, {
        categoryId: vars.categoryId,
        period: DEFAULT_BUDGET_PERIOD,
        amountMinor: vars.amountMinor,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['budget-summary', hid] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (budgetId: string) => api.delete(`/households/${hid}/budgets/${budgetId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['budget-summary', hid] }),
  });

  const createFundMutation = useMutation({
    mutationFn: (body: { categoryId: string; cadence: SinkingFundCadence; totalMinor: number; nextDueDate: string; method: SinkingFundMethod; startMode: SinkingFundStartMode }) =>
      api.post(`/households/${hid}/sinking-funds`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sinking-funds', hid] });
      qc.invalidateQueries({ queryKey: ['budget-summary', hid] });
    },
  });

  const updateFundMutation = useMutation({
    mutationFn: (vars: { id: string; body: Record<string, unknown> }) =>
      api.patch(`/households/${hid}/sinking-funds/${vars.id}`, vars.body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sinking-funds', hid] });
      qc.invalidateQueries({ queryKey: ['budget-summary', hid] });
    },
  });

  const deleteFundMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/households/${hid}/sinking-funds/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sinking-funds', hid] });
      qc.invalidateQueries({ queryKey: ['budget-summary', hid] });
    },
  });

  function toggleExpanded(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  const allItems = summaryQ.data?.items ?? [];

  function itemTotalBudget(i: BudgetSummaryItem): number {
    const childrenSum = i.children.reduce((s, c) => s + c.budgetMinor, 0);
    return i.defaultBudgetAmountMinor + i.sinkingFundMinor + childrenSum;
  }

  // "Set" = has own default, sinking fund, OR any budgeted subcategory
  const setItems = allItems
    .filter((i) => itemTotalBudget(i) > 0)
    .sort((a, b) => itemTotalBudget(b) - itemTotalBudget(a));
  const unsetItems = allItems
    .filter((i) => itemTotalBudget(i) === 0)
    .sort((a, b) => a.categoryName.localeCompare(b.categoryName));
  const items = [...setItems, ...unsetItems];
  const visibleItems = showAll ? items : items.slice(0, EXPENSE_VISIBLE_COUNT);
  const hiddenCount = Math.max(0, items.length - EXPENSE_VISIBLE_COUNT);

  // Expense categories for sinking fund picker
  const expenseCategories: { id: string; name: string }[] = [];
  for (const c of categoriesQ.data ?? []) {
    if (c.kind !== 'expense') continue;
    expenseCategories.push({ id: c.id, name: c.name });
    for (const ch of c.children ?? []) {
      if (ch.kind === 'expense') expenseCategories.push({ id: ch.id, name: `${c.name} › ${ch.name}` });
    }
  }

  return (
    <div className="p-6 space-y-6 max-w-4xl">

      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <button
            onClick={() => navigate('/budgets')}
            className="text-xs text-blue-600 hover:underline mb-1 flex items-center gap-1"
          >
            ← Back to budget overview
          </button>
          <h1 className="text-2xl font-semibold text-gray-900">Manage Budget</h1>
        </div>
        <Button variant="secondary" size="sm" onClick={() => navigate('/categories')}>
          ⚙ Manage categories
        </Button>
      </div>

      {/* Default monthly budgets */}
      <div className="space-y-3">
        <div>
          <h2 className="text-base font-semibold text-gray-900">Default monthly budgets</h2>
          <p className="text-sm text-gray-500">These amounts apply every month. Use the Budget overview to set one-month variations.</p>
        </div>

        <Card padding="md">
          {summaryQ.isLoading ? (
            <p className="text-sm text-gray-400">Loading…</p>
          ) : items.length === 0 ? (
            <p className="text-sm text-gray-400">No expense categories yet. <button onClick={() => navigate('/categories')} className="text-blue-600 hover:underline">Add categories →</button></p>
          ) : (
            <div className="space-y-2">
              {visibleItems.map((item) => (
                <DefaultBudgetRow
                  key={item.categoryId}
                  item={item}
                  currency={currency}
                  depth={0}
                  expanded={expanded}
                  onToggle={toggleExpanded}
                  onSave={(categoryId, amountMinor) => upsertMutation.mutate({ categoryId, amountMinor })}
                  onDelete={(budgetId) => deleteMutation.mutate(budgetId)}
                />
              ))}
              {!showAll && hiddenCount > 0 && (
                <button
                  onClick={() => setShowAll(true)}
                  className="w-full text-center text-sm text-blue-600 hover:underline py-1"
                >
                  Show {hiddenCount} more {hiddenCount === 1 ? 'category' : 'categories'}
                </button>
              )}
              {showAll && items.length > EXPENSE_VISIBLE_COUNT && (
                <button
                  onClick={() => setShowAll(false)}
                  className="w-full text-center text-sm text-gray-400 hover:text-gray-600 py-1"
                >
                  Show less
                </button>
              )}
            </div>
          )}
        </Card>
      </div>

      {/* Annual / amortized expenses */}
      <SinkingFundsSection
        funds={sinkingFundsQ.data ?? []}
        loading={sinkingFundsQ.isLoading}
        currency={currency}
        categories={expenseCategories}
        onCreate={(body) => createFundMutation.mutate(body)}
        onUpdate={(id, body) => updateFundMutation.mutate({ id, body })}
        onDelete={(id) => deleteFundMutation.mutate(id)}
        creating={createFundMutation.isPending}
        createError={createFundMutation.error instanceof ApiException ? createFundMutation.error.message : null}
      />

      <div className="rounded-lg border-l-4 border-l-emerald-400 bg-emerald-50 px-4 py-3 text-sm text-gray-600">
        <b className="text-gray-800">Amortized expenses</b> spread a yearly bill evenly across months into a <b className="text-gray-800">virtual reserve</b>. The monthly budget shows the set-aside; when the bill is paid it draws from the reserve instead of spiking that month.
      </div>
    </div>
  );
}

// ─── Default budget row ───────────────────────────────────────────────────────

function DefaultBudgetRow({
  item, currency, depth, expanded, onToggle, onSave, onDelete,
}: {
  item: BudgetSummaryItem;
  currency: string;
  depth: number;
  expanded: Set<string>;
  onToggle: (id: string) => void;
  onSave: (categoryId: string, amountMinor: number) => void;
  onDelete: (budgetId: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');

  const hasChildren = item.children.length > 0;
  const isExpanded = expanded.has(item.categoryId);
  const hasDefault = item.defaultBudgetId != null;

  // Sum of all subcategory budgets (their own defaults + sinking funds, recursively)
  const childrenBudgetSum = item.children.reduce((s, c) => s + c.budgetMinor, 0);
  // Total effective budget for this category = own + sinking fund + children sum
  const totalBudget = item.defaultBudgetAmountMinor + item.sinkingFundMinor + childrenBudgetSum;

  function startEdit() {
    setDraft(minorToInputOrEmpty(item.defaultBudgetAmountMinor));
    setEditing(true);
  }

  function save() {
    onSave(item.categoryId, inputToMinor(draft));
    setEditing(false);
  }

  const content = (
    <div className="flex items-start gap-2">
      <div className="flex-shrink-0 mt-0.5">
        {hasChildren ? (
          <button onClick={() => onToggle(item.categoryId)}>
            <Chevron expanded={isExpanded} />
          </button>
        ) : (
          <span className="w-5 flex-shrink-0 inline-block" />
        )}
      </div>
      <span
        className="inline-block w-2.5 h-2.5 rounded-full flex-shrink-0 mt-1"
        style={{ background: item.categoryColor ?? '#A0AEC0' }}
      />
      <div className="flex-1 min-w-0">
        <span className={`${depth === 0 ? 'font-medium text-gray-800' : 'text-sm text-gray-600'}`}>
          {item.categoryName}
          {hasChildren && depth === 0 && (
            <span className="text-xs text-gray-400 font-normal ml-1.5">{item.children.length} sub</span>
          )}
        </span>
        {/* Show subcategory sum as the floor context for parent categories */}
        {hasChildren && childrenBudgetSum > 0 && (
          <div className="text-xs text-gray-400 mt-0.5">
            {fmtMinor(childrenBudgetSum, currency)}/mo from subcategories
            {item.defaultBudgetAmountMinor > 0 && (
              <> + {fmtMinor(item.defaultBudgetAmountMinor, currency)}/mo own</>
            )}
          </div>
        )}
      </div>

      {item.sinkingFundMinor > 0 && (
        <Badge variant="info">+{fmtMinor(item.sinkingFundMinor, currency)}/mo reserve</Badge>
      )}

      {editing ? (
        <div className="flex items-center gap-2 flex-shrink-0">
          {hasChildren && childrenBudgetSum > 0 && (
            <span className="text-xs text-gray-400 whitespace-nowrap">
              +{fmtMinor(childrenBudgetSum, currency)} sub =
            </span>
          )}
          <span className="text-sm text-gray-400">{CURRENCY_SYMBOLS[currency] ?? currency}</span>
          <input
            type="number" step="0.01" min="0" autoFocus placeholder="0.00"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') save(); if (e.key === 'Escape') setEditing(false); }}
            className="w-24 h-8 rounded-md border border-gray-300 px-2 text-sm"
          />
          <button onClick={save} className="text-xs font-medium text-white bg-blue-600 px-2.5 py-1.5 rounded-md hover:bg-blue-700">
            Save
          </button>
          <button onClick={() => setEditing(false)} className="text-xs text-gray-500 hover:text-gray-700">
            Cancel
          </button>
        </div>
      ) : (
        <div className="flex items-center gap-3 flex-shrink-0">
          {totalBudget > 0 && (
            <span className="text-sm tabular-nums font-medium text-gray-700 whitespace-nowrap">
              {fmtMinor(totalBudget, currency)}/mo
            </span>
          )}
          {hasDefault ? (
            <>
              <button onClick={startEdit} className="text-xs text-blue-600 hover:underline">
                {hasChildren ? 'Edit own' : 'Edit'}
              </button>
              <button onClick={() => onDelete(item.defaultBudgetId!)} className="text-xs text-gray-400 hover:text-red-500">
                Remove
              </button>
            </>
          ) : (
            <button onClick={startEdit} className="text-xs text-blue-600 hover:underline">
              {hasChildren ? 'Add own' : 'Set budget'}
            </button>
          )}
        </div>
      )}
    </div>
  );

  return (
    <div>
      <div
        className={`py-2 px-3 rounded-lg ${depth === 0 ? 'border border-gray-100' : ''} ${!hasDefault && !item.sinkingFundMinor ? 'opacity-60' : ''}`}
        style={depth === 0 && item.categoryColor ? { borderLeftWidth: 3, borderLeftColor: item.categoryColor } : undefined}
      >
        {content}
      </div>
      {hasChildren && isExpanded && (
        <div className="ml-4 pl-3 border-l border-gray-200 space-y-1 mt-1">
          {item.children.map((child) => (
            <DefaultBudgetRow
              key={child.categoryId}
              item={child}
              currency={currency}
              depth={depth + 1}
              expanded={expanded}
              onToggle={onToggle}
              onSave={onSave}
              onDelete={onDelete}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Sinking funds section ────────────────────────────────────────────────────

const STATUS_BADGE: Record<string, 'success' | 'info' | 'warning'> = {
  ahead: 'success', 'on-track': 'info', behind: 'warning',
};

function SinkingFundsSection({
  funds, loading, currency, categories, onCreate, onUpdate, onDelete, creating, createError,
}: {
  funds: SinkingFundResponse[];
  loading: boolean;
  currency: string;
  categories: { id: string; name: string }[];
  onCreate: (body: { categoryId: string; cadence: SinkingFundCadence; totalMinor: number; nextDueDate: string; method: SinkingFundMethod; startMode: SinkingFundStartMode }) => void;
  onUpdate: (id: string, body: Record<string, unknown>) => void;
  onDelete: (id: string) => void;
  creating: boolean;
  createError: string | null;
}) {
  const [showForm, setShowForm] = useState(false);
  const [categoryId, setCategoryId] = useState('');
  const [cadence, setCadence] = useState<SinkingFundCadence>('annual');
  const [total, setTotal] = useState('');
  const [nextDueDate, setNextDueDate] = useState('');
  const [method, setMethod] = useState<SinkingFundMethod>('amortized');
  const [startMode, setStartMode] = useState<SinkingFundStartMode>('gradual');

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!categoryId || !nextDueDate) return;
    onCreate({ categoryId, cadence, totalMinor: inputToMinor(total), nextDueDate, method, startMode });
    setShowForm(false);
    setCategoryId(''); setTotal(''); setNextDueDate('');
    setMethod('amortized'); setStartMode('gradual');
  }

  const cadenceLabel: Record<SinkingFundCadence, string> = {
    annual: 'per year', semi: 'per 6 months', quarterly: 'per quarter',
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h2 className="text-base font-semibold text-gray-900 flex items-center gap-2">
            Annual &amp; amortized expenses
            <Badge variant="info">sinking funds</Badge>
          </h2>
          <p className="text-sm text-gray-500">Spread irregular bills evenly — insurance, subscriptions, car service, etc.</p>
        </div>
        <Button type="button" variant="secondary" size="sm" onClick={() => setShowForm((v) => !v)}>
          {showForm ? 'Cancel' : '+ Add annual expense'}
        </Button>
      </div>

      {showForm && (
        <Card padding="sm">
          <form onSubmit={submit} className="grid grid-cols-2 md:grid-cols-3 gap-3">
            <div className="space-y-1">
              <label className="block text-xs font-medium text-gray-700">Category</label>
              <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} required className="block w-full h-9 rounded-md border border-gray-300 px-2 text-sm">
                <option value="">Select…</option>
                {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div className="space-y-1">
              <label className="block text-xs font-medium text-gray-700">Total amount</label>
              <div className="flex items-center gap-1">
                <span className="text-sm text-gray-400">{CURRENCY_SYMBOLS[currency] ?? currency}</span>
                <input type="number" step="0.01" min="0" placeholder="0.00" value={total} onChange={(e) => setTotal(e.target.value)} required className="block w-full h-9 rounded-md border border-gray-300 px-2 text-sm" />
              </div>
            </div>
            <div className="space-y-1">
              <label className="block text-xs font-medium text-gray-700">Cadence</label>
              <select value={cadence} onChange={(e) => setCadence(e.target.value as SinkingFundCadence)} className="block w-full h-9 rounded-md border border-gray-300 px-2 text-sm">
                <option value="annual">Annual</option>
                <option value="semi">Semi-annual</option>
                <option value="quarterly">Quarterly</option>
              </select>
            </div>
            <div className="space-y-1">
              <label className="block text-xs font-medium text-gray-700">Next due date</label>
              <input type="date" value={nextDueDate} onChange={(e) => setNextDueDate(e.target.value)} required className="block w-full h-9 rounded-md border border-gray-300 px-2 text-sm" />
            </div>
            <div className="space-y-1">
              <label className="block text-xs font-medium text-gray-700">Method</label>
              <select value={method} onChange={(e) => setMethod(e.target.value as SinkingFundMethod)} className="block w-full h-9 rounded-md border border-gray-300 px-2 text-sm">
                <option value="amortized">Amortized (set aside monthly)</option>
                <option value="actual">Actual (full hit when paid)</option>
              </select>
            </div>
            <div className="space-y-1">
              <label className="block text-xs font-medium text-gray-700">Start mode</label>
              <select value={startMode} onChange={(e) => setStartMode(e.target.value as SinkingFundStartMode)} disabled={method === 'actual'} className="block w-full h-9 rounded-md border border-gray-300 px-2 text-sm disabled:bg-gray-100">
                <option value="gradual">Gradual (catch up over time)</option>
                <option value="frontload">Frontload (count from cycle start)</option>
              </select>
            </div>
            <div className="col-span-2 md:col-span-3 flex items-center gap-2">
              <Button type="submit" loading={creating}>Add fund</Button>
              {createError && <span className="text-xs text-red-600">{createError}</span>}
            </div>
          </form>
        </Card>
      )}

      <Card padding="none">
        {loading ? (
          <p className="text-sm text-gray-400 p-4">Loading…</p>
        ) : funds.length === 0 ? (
          <p className="text-sm text-gray-400 p-4">No annual / amortized expenses yet. Add one above.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  <th className="px-4 py-2.5">Expense</th>
                  <th className="px-4 py-2.5">Total</th>
                  <th className="px-4 py-2.5">Monthly set-aside</th>
                  <th className="px-4 py-2.5">Reserve saved</th>
                  <th className="px-4 py-2.5">Next due</th>
                  <th className="px-4 py-2.5"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {funds.map((fund) => (
                  <SinkingFundRow key={fund.id} fund={fund} currency={currency} cadenceLabel={cadenceLabel} onUpdate={onUpdate} onDelete={onDelete} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

function SinkingFundRow({
  fund, currency, cadenceLabel, onUpdate, onDelete,
}: {
  fund: SinkingFundResponse;
  currency: string;
  cadenceLabel: Record<SinkingFundCadence, string>;
  onUpdate: (id: string, body: Record<string, unknown>) => void;
  onDelete: (id: string) => void;
}) {
  const [editingBalance, setEditingBalance] = useState(false);
  const [balanceDraft, setBalanceDraft] = useState(() => minorToInputOrEmpty(fund.reserveBalanceMinor));

  const progressRatio = fund.totalMinor > 0 ? Math.min(1, fund.reserveBalanceMinor / fund.totalMinor) : 0;
  const targetRatio = fund.totalMinor > 0 ? Math.min(1, fund.targetByNowMinor / fund.totalMinor) : 0;
  const fillColor = fund.status === 'behind' ? 'bg-red-500' : fund.status === 'ahead' ? 'bg-emerald-500' : 'bg-blue-500';

  function saveBalance() {
    onUpdate(fund.id, { reserveBalanceMinor: inputToMinor(balanceDraft) });
    setEditingBalance(false);
  }

  return (
    <tr className="align-top">
      <td className="px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="font-medium text-gray-800">{fund.categoryName}</span>
          {fund.cadence !== 'annual' && <span className="text-xs text-gray-400">({fund.cadence === 'semi' ? '6-mo' : 'quarterly'})</span>}
        </div>
        <div className="flex items-center gap-1.5 mt-1">
          <Badge variant={STATUS_BADGE[fund.status]}>{fund.status}</Badge>
          {fund.method === 'actual' && <Badge variant="default">actual</Badge>}
        </div>
      </td>
      <td className="px-4 py-3 tabular-nums whitespace-nowrap">
        {fmtMinor(fund.totalMinor, currency)}
        <div className="text-xs text-gray-400">{cadenceLabel[fund.cadence]}</div>
      </td>
      <td className="px-4 py-3 tabular-nums whitespace-nowrap">
        {fund.method === 'amortized' ? `${fmtMinor(fund.monthlyAmountMinor, currency)}/mo` : '—'}
      </td>
      <td className="px-4 py-3 min-w-[170px]">
        {fund.method === 'amortized' ? (
          <>
            <div className="relative h-2 w-full rounded-full bg-gray-100 overflow-hidden mb-1">
              <div className={`absolute h-full rounded-full ${fillColor}`} style={{ width: `${progressRatio * 100}%` }} />
              <div className="absolute top-0 h-full border-r-2 border-gray-400" style={{ left: `${targetRatio * 100}%` }} />
            </div>
            {editingBalance ? (
              <span className="flex items-center gap-1.5 text-xs">
                <span className="text-gray-400">{CURRENCY_SYMBOLS[currency] ?? currency}</span>
                <input
                  type="number" step="0.01" min="0" autoFocus placeholder="0.00"
                  value={balanceDraft}
                  onChange={(e) => setBalanceDraft(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') saveBalance(); if (e.key === 'Escape') setEditingBalance(false); }}
                  className="w-24 h-7 rounded-md border border-gray-300 px-2 text-xs"
                />
                <button onClick={saveBalance} className="text-blue-600 hover:underline">Save</button>
                <button onClick={() => setEditingBalance(false)} className="text-gray-400 hover:text-gray-600">Cancel</button>
              </span>
            ) : (
              <button onClick={() => { setBalanceDraft(minorToInputOrEmpty(fund.reserveBalanceMinor)); setEditingBalance(true); }} className="text-xs text-gray-500 hover:underline tabular-nums">
                {fmtMinor(fund.reserveBalanceMinor, currency)} of {fmtMinor(fund.totalMinor, currency)}
              </button>
            )}
            {fund.shortfallMinor > 0 && (
              <div className="text-xs text-amber-600 mt-0.5">short {fmtMinor(fund.shortfallMinor, currency)}</div>
            )}
          </>
        ) : (
          <span className="text-xs text-gray-400">full hit when paid</span>
        )}
      </td>
      <td className="px-4 py-3 whitespace-nowrap">{fund.nextDueDate}</td>
      <td className="px-4 py-3 text-right">
        <button onClick={() => onDelete(fund.id)} className="text-xs text-red-500 hover:text-red-700">Delete</button>
      </td>
    </tr>
  );
}
