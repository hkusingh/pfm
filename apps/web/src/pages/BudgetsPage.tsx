import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, Button, Badge } from '@pfm/ui';
import { api, ApiException } from '../lib/api';
import type {
  BudgetSummaryItem,
  BudgetSummaryResponse,
  SinkingFundResponse,
  IncomeSummaryResponse,
  SinkingFundCadence,
  SinkingFundMethod,
  SinkingFundStartMode,
} from '@pfm/contracts';

type Household = { id: string; name: string };
type Category = { id: string; name: string; kind: 'expense' | 'income' | 'transfer'; children?: Category[] };

const CURRENCY_SYMBOLS: Record<string, string> = { USD: '$', EUR: '€', GBP: '£', INR: '₹' };

function fmtMinor(minor: number, currency: string): string {
  const symbol = CURRENCY_SYMBOLS[currency] ?? currency + ' ';
  const sign = minor < 0 ? '-' : '';
  return `${sign}${symbol}${(Math.abs(minor) / 100).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

function minorToInput(minor: number): string {
  return (minor / 100).toFixed(2);
}

function inputToMinor(value: string): number {
  const n = Math.round(parseFloat(value || '0') * 100);
  return Number.isFinite(n) ? n : 0;
}

function currentPeriod(): string {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
}

function shiftPeriod(period: string, delta: number): string {
  const [y, m] = period.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

function periodLabel(period: string): string {
  const [y, m] = period.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleString('default', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

// ─── Progress bar ───────────────────────────────────────────────────────────

function ProgressBar({ ratio, color }: { ratio: number; color: 'green' | 'amber' | 'red' | 'blue' }) {
  const colors: Record<string, string> = {
    green: 'bg-emerald-500',
    amber: 'bg-amber-500',
    red: 'bg-red-500',
    blue: 'bg-blue-500',
  };
  const pct = Math.max(0, Math.min(1, ratio)) * 100;
  return (
    <div className="h-2 w-full rounded-full bg-gray-100 overflow-hidden">
      <div className={`h-full rounded-full ${colors[color]}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

function utilizationColor(spent: number, budget: number): 'green' | 'amber' | 'red' {
  if (budget <= 0) return 'green';
  const ratio = spent / budget;
  if (ratio > 1) return 'red';
  if (ratio >= 0.8) return 'amber';
  return 'green';
}

export function BudgetsPage() {
  const qc = useQueryClient();

  const { data: household } = useQuery({
    queryKey: ['household'],
    queryFn: () => api.get<Household>('/households/me'),
  });
  const hid = household?.id;

  const [period, setPeriod] = useState(currentPeriod());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const summaryQ = useQuery({
    queryKey: ['budget-summary', hid, period],
    queryFn: () => api.get<BudgetSummaryResponse>(`/households/${hid}/budgets?period=${period}`),
    enabled: !!hid,
  });

  const incomeQ = useQuery({
    queryKey: ['income-summary', hid, period],
    queryFn: () => api.get<IncomeSummaryResponse>(`/households/${hid}/income-summary?period=${period}`),
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

  // ── Mutations ────────────────────────────────────────────────────────────

  const upsertBudgetMutation = useMutation({
    mutationFn: (vars: { categoryId: string; amountMinor: number }) =>
      api.put(`/households/${hid}/budgets`, { categoryId: vars.categoryId, period, amountMinor: vars.amountMinor }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['budget-summary', hid, period] }),
  });

  const deleteBudgetMutation = useMutation({
    mutationFn: (budgetId: string) => api.delete(`/households/${hid}/budgets/${budgetId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['budget-summary', hid, period] }),
  });

  const createFundMutation = useMutation({
    mutationFn: (body: { categoryId: string; cadence: SinkingFundCadence; totalMinor: number; nextDueDate: string; method: SinkingFundMethod; startMode: SinkingFundStartMode }) =>
      api.post(`/households/${hid}/sinking-funds`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sinking-funds', hid] });
      qc.invalidateQueries({ queryKey: ['budget-summary', hid, period] });
    },
  });

  const updateFundMutation = useMutation({
    mutationFn: (vars: { id: string; body: Record<string, unknown> }) =>
      api.patch(`/households/${hid}/sinking-funds/${vars.id}`, vars.body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sinking-funds', hid] });
      qc.invalidateQueries({ queryKey: ['budget-summary', hid, period] });
    },
  });

  const deleteFundMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/households/${hid}/sinking-funds/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sinking-funds', hid] });
      qc.invalidateQueries({ queryKey: ['budget-summary', hid, period] });
    },
  });

  function toggleExpanded(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const items = summaryQ.data?.items ?? [];
  const maxBudget = Math.max(1, ...items.map((i) => i.budgetMinor));

  // Flatten expense categories (top-level only, for the sinking-fund category picker)
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

        {/* Header + period picker */}
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold text-gray-900">Budgets</h1>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPeriod((p) => shiftPeriod(p, -1))}
              className="w-8 h-8 flex items-center justify-center rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50"
            >
              ‹
            </button>
            <span className="text-sm font-medium text-gray-700 w-36 text-center">{periodLabel(period)}</span>
            <button
              onClick={() => setPeriod((p) => shiftPeriod(p, 1))}
              className="w-8 h-8 flex items-center justify-center rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50"
            >
              ›
            </button>
          </div>
        </div>

        {/* Monthly budgets */}
        <Card padding="md">
          <p className="text-sm font-semibold text-gray-900 mb-3">Monthly budgets</p>
          {summaryQ.isLoading ? (
            <p className="text-sm text-gray-400">Loading…</p>
          ) : items.length === 0 ? (
            <p className="text-sm text-gray-400">No expense categories yet.</p>
          ) : (
            <div className="space-y-3">
              {items.map((item) => (
                <BudgetRow
                  key={item.categoryId}
                  item={item}
                  currency={currency}
                  maxBudget={maxBudget}
                  depth={0}
                  expanded={expanded}
                  onToggle={toggleExpanded}
                  onSave={(categoryId, amountMinor) => upsertBudgetMutation.mutate({ categoryId, amountMinor })}
                  onDelete={(budgetId) => deleteBudgetMutation.mutate(budgetId)}
                />
              ))}
            </div>
          )}
        </Card>

        {/* Income tracking */}
        <Card padding="md">
          <p className="text-sm font-semibold text-gray-900 mb-1">Income tracking</p>
          <p className="text-xs text-gray-400 mb-3">Received vs expected this period — not a spend cap.</p>
          {incomeQ.isLoading ? (
            <p className="text-sm text-gray-400">Loading…</p>
          ) : (incomeQ.data?.items.length ?? 0) === 0 ? (
            <p className="text-sm text-gray-400">No income categories yet.</p>
          ) : (
            <div className="space-y-3">
              {incomeQ.data!.items.map((item) => (
                <div key={item.categoryId}>
                  <div className="flex items-center justify-between text-sm mb-1">
                    <span className="flex items-center gap-2 font-medium text-gray-800">
                      <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: item.categoryColor ?? '#A0AEC0' }} />
                      {item.categoryName}
                    </span>
                    <span className="text-gray-500 tabular-nums">
                      {fmtMinor(item.receivedMinor, currency)}
                      {item.expectedMinor > 0 && <span className="text-gray-400"> / {fmtMinor(item.expectedMinor, currency)}</span>}
                    </span>
                  </div>
                  {item.expectedMinor > 0 && (
                    <ProgressBar ratio={item.receivedMinor / item.expectedMinor} color="blue" />
                  )}
                </div>
              ))}
            </div>
          )}
        </Card>

        {/* Sinking funds */}
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

      </div>
  );
}

// ─── Budget row (recursive) ───────────────────────────────────────────────────

function BudgetRow({
  item, currency, maxBudget, depth, expanded, onToggle, onSave, onDelete,
}: {
  item: BudgetSummaryItem;
  currency: string;
  maxBudget: number;
  depth: number;
  expanded: Set<string>;
  onToggle: (id: string) => void;
  onSave: (categoryId: string, amountMinor: number) => void;
  onDelete: (budgetId: string) => void;
}) {
  const childrenBudgetMinor = item.children.reduce((s, c) => s + c.budgetMinor, 0);
  const ownBudgetMinor = item.budgetMinor - item.sinkingFundMinor - childrenBudgetMinor;

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(() => minorToInput(ownBudgetMinor));

  const hasChildren = item.children.length > 0;
  const isExpanded = expanded.has(item.categoryId);
  const barLength = Math.max(8, (item.budgetMinor / maxBudget) * 100);
  const color = utilizationColor(item.spentMinor, item.budgetMinor);

  function startEdit() {
    setDraft(minorToInput(ownBudgetMinor));
    setEditing(true);
  }

  function save() {
    onSave(item.categoryId, inputToMinor(draft));
    setEditing(false);
  }

  return (
    <div>
      <div className="flex items-center gap-2">
        {hasChildren ? (
          <button
            onClick={() => onToggle(item.categoryId)}
            className="w-5 h-5 flex items-center justify-center rounded text-gray-400 hover:text-gray-700 hover:bg-gray-100 flex-shrink-0"
            style={{ transform: isExpanded ? 'rotate(0deg)' : 'rotate(-90deg)', transition: 'transform 150ms' }}
          >
            <svg width="12" height="12" viewBox="0 0 14 14" fill="none">
              <path d="M3 5l4 4 4-4" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        ) : (
          <span className="w-5 flex-shrink-0" />
        )}

        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between text-sm mb-1">
            <span className="flex items-center gap-2 font-medium text-gray-800 truncate" style={{ marginLeft: depth * 12 }}>
              <span className="inline-block w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: item.categoryColor ?? '#A0AEC0' }} />
              {item.categoryName}
              {item.sinkingFundMinor > 0 && (
                <Badge variant="info">+{fmtMinor(item.sinkingFundMinor, currency)} reserve</Badge>
              )}
            </span>
            {!editing && (
              <span className="flex items-center gap-2 flex-shrink-0">
                <span className="text-gray-500 tabular-nums">
                  {fmtMinor(item.spentMinor, currency)}
                  {item.budgetMinor > 0 && <span className="text-gray-400"> / {fmtMinor(item.budgetMinor, currency)}</span>}
                </span>
                <button onClick={startEdit} className="text-xs text-blue-600 hover:underline">
                  {item.budgetId ? 'Edit' : 'Set budget'}
                </button>
                {item.budgetId && (
                  <button onClick={() => onDelete(item.budgetId!)} className="text-xs text-red-500 hover:text-red-700">
                    Clear
                  </button>
                )}
              </span>
            )}
          </div>

          {editing ? (
            <div className="flex items-center gap-2 mb-1">
              <span className="text-sm text-gray-400">{CURRENCY_SYMBOLS[currency] ?? currency}</span>
              <input
                type="number"
                step="0.01"
                min="0"
                autoFocus
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') save(); if (e.key === 'Escape') setEditing(false); }}
                className="w-28 h-8 rounded-md border border-gray-300 px-2 text-sm"
              />
              <button onClick={save} className="text-xs font-medium text-white bg-blue-600 px-2.5 py-1.5 rounded-md hover:bg-blue-700">
                Save
              </button>
              <button onClick={() => setEditing(false)} className="text-xs text-gray-500 hover:text-gray-700">
                Cancel
              </button>
            </div>
          ) : (
            <div style={{ width: `${barLength}%`, minWidth: '40px' }}>
              <ProgressBar ratio={item.budgetMinor > 0 ? item.spentMinor / item.budgetMinor : 0} color={color} />
            </div>
          )}
        </div>
      </div>

      {hasChildren && isExpanded && (
        <div className="mt-2 space-y-2 pl-1">
          {item.children.map((child) => (
            <BudgetRow
              key={child.categoryId}
              item={child}
              currency={currency}
              maxBudget={maxBudget}
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

// ─── Sinking funds section ─────────────────────────────────────────────────────

const STATUS_BADGE: Record<string, 'success' | 'info' | 'warning'> = {
  ahead: 'success',
  'on-track': 'info',
  behind: 'warning',
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
    setCategoryId('');
    setTotal('');
    setNextDueDate('');
    setMethod('amortized');
    setStartMode('gradual');
  }

  return (
    <Card padding="md">
      <div className="flex items-center justify-between mb-1">
        <p className="text-sm font-semibold text-gray-900">Sinking funds</p>
        <Button type="button" variant="secondary" onClick={() => setShowForm((v) => !v)}>
          {showForm ? 'Cancel' : '+ Add sinking fund'}
        </Button>
      </div>
      <p className="text-xs text-gray-400 mb-3">
        Spread annual, semi-annual, or quarterly expenses into a monthly virtual reserve.
      </p>

      {showForm && (
        <form onSubmit={submit} className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-4 p-3 rounded-lg border border-gray-100 bg-gray-50">
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
              <input type="number" step="0.01" min="0" value={total} onChange={(e) => setTotal(e.target.value)} required className="block w-full h-9 rounded-md border border-gray-300 px-2 text-sm" />
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
      )}

      {loading ? (
        <p className="text-sm text-gray-400">Loading…</p>
      ) : funds.length === 0 ? (
        <p className="text-sm text-gray-400">No sinking funds yet.</p>
      ) : (
        <div className="space-y-3">
          {funds.map((fund) => (
            <SinkingFundRow key={fund.id} fund={fund} currency={currency} onUpdate={onUpdate} onDelete={onDelete} />
          ))}
        </div>
      )}
    </Card>
  );
}

function SinkingFundRow({
  fund, currency, onUpdate, onDelete,
}: {
  fund: SinkingFundResponse;
  currency: string;
  onUpdate: (id: string, body: Record<string, unknown>) => void;
  onDelete: (id: string) => void;
}) {
  const [editingBalance, setEditingBalance] = useState(false);
  const [balanceDraft, setBalanceDraft] = useState(() => minorToInput(fund.reserveBalanceMinor));

  const progressRatio = fund.totalMinor > 0 ? Math.min(1, fund.reserveBalanceMinor / fund.totalMinor) : 0;
  const targetRatio = fund.totalMinor > 0 ? Math.min(1, fund.targetByNowMinor / fund.totalMinor) : 0;

  function saveBalance() {
    onUpdate(fund.id, { reserveBalanceMinor: inputToMinor(balanceDraft) });
    setEditingBalance(false);
  }

  return (
    <div className="rounded-lg border border-gray-100 p-3">
      <div className="flex items-center justify-between mb-1">
        <span className="flex items-center gap-2 text-sm font-medium text-gray-800">
          {fund.categoryName}
          <Badge variant={STATUS_BADGE[fund.status]}>{fund.status}</Badge>
          {fund.method === 'actual' && <Badge variant="default">actual</Badge>}
        </span>
        <button onClick={() => onDelete(fund.id)} className="text-xs text-red-500 hover:text-red-700">Delete</button>
      </div>

      <p className="text-xs text-gray-500 mb-2">
        {fmtMinor(fund.totalMinor, currency)} {fund.cadence === 'annual' ? 'per year' : fund.cadence === 'semi' ? 'per 6 months' : 'per quarter'}
        {' · '}due {fund.nextDueDate}
        {fund.method === 'amortized' && <> · {fmtMinor(fund.monthlyAmountMinor, currency)}/mo set-aside</>}
      </p>

      {fund.method === 'amortized' && (
        <>
          <div className="relative h-2 w-full rounded-full bg-gray-100 overflow-hidden mb-1">
            <div className="absolute h-full rounded-full bg-emerald-500" style={{ width: `${progressRatio * 100}%` }} />
            <div className="absolute top-0 h-full border-r-2 border-gray-400" style={{ left: `${targetRatio * 100}%` }} />
          </div>
          <div className="flex items-center justify-between text-xs text-gray-500">
            {editingBalance ? (
              <span className="flex items-center gap-1.5">
                <span className="text-gray-400">{CURRENCY_SYMBOLS[currency] ?? currency}</span>
                <input
                  type="number" step="0.01" min="0" autoFocus
                  value={balanceDraft}
                  onChange={(e) => setBalanceDraft(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') saveBalance(); if (e.key === 'Escape') setEditingBalance(false); }}
                  className="w-24 h-7 rounded-md border border-gray-300 px-2 text-xs"
                />
                <button onClick={saveBalance} className="text-blue-600 hover:underline">Save</button>
                <button onClick={() => setEditingBalance(false)} className="text-gray-400 hover:text-gray-600">Cancel</button>
              </span>
            ) : (
              <button onClick={() => { setBalanceDraft(minorToInput(fund.reserveBalanceMinor)); setEditingBalance(true); }} className="hover:underline">
                Saved {fmtMinor(fund.reserveBalanceMinor, currency)} of {fmtMinor(fund.totalMinor, currency)}
              </button>
            )}
            <span>
              target {fmtMinor(fund.targetByNowMinor, currency)}
              {fund.shortfallMinor > 0 && <span className="text-amber-600"> · short {fmtMinor(fund.shortfallMinor, currency)}</span>}
            </span>
          </div>
        </>
      )}
    </div>
  );
}
