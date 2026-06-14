import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
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

function minorToInputOrEmpty(minor: number): string {
  return minor === 0 ? '' : minorToInput(minor);
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

// ─── Magnitude bar (two-level: track = relative size, fill = utilization) ──────

function MagnitudeBar({
  sizeRatio, fillRatio, fillColor, trackColor, small,
}: {
  sizeRatio: number;
  fillRatio: number;
  fillColor: string;
  trackColor: string;
  small?: boolean;
}) {
  const size = Math.max(2, Math.min(100, sizeRatio * 100));
  const fill = Math.max(0, Math.min(100, fillRatio * 100));
  return (
    <div className={`w-full ${small ? 'h-3.5' : 'h-5'} rounded-md bg-gray-50 border border-gray-100 overflow-hidden`}>
      <div className={`h-full rounded-md ${trackColor}`} style={{ width: `${size}%` }}>
        <div className={`h-full rounded-md ${fillColor}`} style={{ width: `${fill}%` }} />
      </div>
    </div>
  );
}

function spentColor(spentMinor: number, budgetMinor: number): string {
  if (budgetMinor <= 0) return 'bg-gray-300';
  const ratio = spentMinor / budgetMinor;
  if (ratio > 1) return 'bg-red-500';
  if (ratio >= 0.8) return 'bg-amber-500';
  return 'bg-blue-500';
}

export function BudgetsPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();

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

  // income-summary returns a flat list including top-level income categories
  // themselves alongside their sub-categories; only show/total the sub-categories
  // (or the top-level categories if none have sub-categories) to avoid double counting.
  const topLevelIncomeIds = new Set((categoriesQ.data ?? []).filter((c) => c.kind === 'income').map((c) => c.id));
  const allIncomeItems = incomeQ.data?.items ?? [];
  const incomeChildItems = allIncomeItems.filter((i) => !topLevelIncomeIds.has(i.categoryId));
  const incomeItems = incomeChildItems.length > 0 ? incomeChildItems : allIncomeItems;
  const incomeReceivedTotal = incomeItems.reduce((s, i) => s + i.receivedMinor, 0);
  const incomeExpectedTotal = incomeItems.reduce((s, i) => s + i.expectedMinor, 0);
  const maxExpected = Math.max(1, ...incomeItems.map((i) => i.expectedMinor));

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
        <div className="flex items-center justify-between flex-wrap gap-2">
          <h1 className="text-2xl font-semibold text-gray-900">Budgets — {periodLabel(period)}</h1>
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
            <Button variant="secondary" size="sm" onClick={() => navigate('/categories')}>
              ⚙ Manage categories
            </Button>
          </div>
        </div>

        {/* Legend */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-500">
          <span><b className="text-gray-700">Bar length</b> = budget size (relative)</span>
          <span className="flex items-center gap-1.5"><span className="inline-block w-2.5 h-2.5 rounded-sm bg-blue-500" /> spent</span>
          <span className="flex items-center gap-1.5"><span className="inline-block w-2.5 h-2.5 rounded-sm bg-amber-500" /> near limit</span>
          <span className="flex items-center gap-1.5"><span className="inline-block w-2.5 h-2.5 rounded-sm bg-red-500" /> over budget</span>
          <span className="flex items-center gap-1.5"><span className="inline-block w-2.5 h-2.5 rounded-sm bg-gray-300" /> left to spend</span>
        </div>

        {/* Budget groups */}
        <Card padding="md">
          {summaryQ.isLoading || incomeQ.isLoading ? (
            <p className="text-sm text-gray-400">Loading…</p>
          ) : (
            <div className="space-y-3">
              {/* Income group */}
              {incomeItems.length > 0 && (
                <>
                  <div className="rounded-lg border border-emerald-100 border-l-4 border-l-emerald-500 bg-emerald-50/40 p-3">
                    <div className="flex items-center justify-between gap-2 mb-1.5">
                      <button
                        onClick={() => toggleExpanded('__income__')}
                        className="flex items-center gap-2 min-w-0 text-left"
                      >
                        <Chevron expanded={expanded.has('__income__')} />
                        <span className="inline-block w-2.5 h-2.5 rounded-full bg-emerald-500 flex-shrink-0" />
                        <span className="font-semibold text-gray-800 truncate">Income</span>
                        <span className="text-xs text-gray-400 font-normal">{incomeItems.length} sub · expected</span>
                      </button>
                      <span className="text-sm tabular-nums flex-shrink-0">
                        <b className="text-emerald-600">{fmtMinor(incomeReceivedTotal, currency)}</b>
                        <span className="text-gray-400"> received / {fmtMinor(incomeExpectedTotal, currency)} expected</span>
                      </span>
                    </div>
                    <MagnitudeBar
                      sizeRatio={1}
                      fillRatio={incomeExpectedTotal > 0 ? incomeReceivedTotal / incomeExpectedTotal : 0}
                      fillColor="bg-emerald-500"
                      trackColor="bg-emerald-100"
                    />
                    {expanded.has('__income__') && (
                      <div className="mt-2 ml-4 pl-3 border-l border-emerald-100 space-y-2">
                        {incomeItems.map((item) => (
                          <div key={item.categoryId}>
                            <div className="flex items-center justify-between gap-2 mb-1 text-xs">
                              <span className="text-gray-600 font-medium truncate">{item.categoryName}</span>
                              <span className="tabular-nums flex-shrink-0">
                                <b className={item.receivedMinor > 0 ? 'text-emerald-600' : 'text-gray-400'}>
                                  {fmtMinor(item.receivedMinor, currency)}
                                </b>
                                {item.expectedMinor > 0 && <span className="text-gray-400"> / {fmtMinor(item.expectedMinor, currency)} expected</span>}
                              </span>
                            </div>
                            <MagnitudeBar
                              sizeRatio={item.expectedMinor / maxExpected}
                              fillRatio={item.expectedMinor > 0 ? item.receivedMinor / item.expectedMinor : 0}
                              fillColor="bg-emerald-500"
                              trackColor="bg-emerald-100"
                              small
                            />
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                  <p className="text-xs text-gray-400 px-1">
                    ↑ Income tracks <b className="text-gray-500">received vs expected</b> (no spend limit). Categories below track <b className="text-gray-500">spent vs budget</b>.
                  </p>
                </>
              )}

              {/* Expense categories */}
              {items.length === 0 ? (
                <p className="text-sm text-gray-400">No expense categories yet.</p>
              ) : (
                items.map((item) => (
                  <BudgetGroup
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
                ))
              )}
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

        {/* Notes */}
        <div className="rounded-lg border-l-4 border-l-blue-400 bg-blue-50 px-4 py-3 text-sm text-gray-600">
          <b className="text-gray-800">Sub-categories</b> nest under a parent and roll up automatically — the parent total is the sum of its children plus any direct spend.
        </div>
        <div className="rounded-lg border-l-4 border-l-emerald-400 bg-emerald-50 px-4 py-3 text-sm text-gray-600">
          <b className="text-gray-800">Amortized expenses</b> spread a yearly bill evenly across months into a <b className="text-gray-800">virtual reserve</b>. The monthly budget shows the set-aside; when the bill is paid it draws from the reserve instead of spiking that month.
        </div>

      </div>
  );
}

// ─── Chevron toggle ─────────────────────────────────────────────────────────

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

// ─── Budget group (recursive) ───────────────────────────────────────────────

function BudgetGroup({
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
  const [draft, setDraft] = useState(() => minorToInputOrEmpty(ownBudgetMinor));

  const hasChildren = item.children.length > 0;
  const isExpanded = expanded.has(item.categoryId);
  const sizeRatio = item.budgetMinor / maxBudget;
  const fillRatio = item.budgetMinor > 0 ? item.spentMinor / item.budgetMinor : 0;
  const fillColor = spentColor(item.spentMinor, item.budgetMinor);
  const isOver = item.budgetMinor > 0 && item.spentMinor > item.budgetMinor;

  function startEdit() {
    setDraft(minorToInputOrEmpty(ownBudgetMinor));
    setEditing(true);
  }

  function save() {
    onSave(item.categoryId, inputToMinor(draft));
    setEditing(false);
  }

  const content = (
    <>
      <div className="flex items-center justify-between gap-2 mb-1.5">
        <div className="flex items-center gap-2 min-w-0">
          {hasChildren ? (
            <button onClick={() => onToggle(item.categoryId)} className="flex-shrink-0">
              <Chevron expanded={isExpanded} />
            </button>
          ) : (
            <span className="w-5 flex-shrink-0" />
          )}
          <span
            className={`inline-block w-2.5 h-2.5 rounded-full flex-shrink-0`}
            style={{ background: item.categoryColor ?? '#A0AEC0' }}
          />
          <span className={`truncate ${depth === 0 ? 'font-semibold text-gray-800' : 'font-medium text-gray-600 text-sm'}`}>
            {item.categoryName}
          </span>
          {hasChildren && depth === 0 && (
            <span className="text-xs text-gray-400 font-normal flex-shrink-0">{item.children.length} sub</span>
          )}
          {item.sinkingFundMinor > 0 && (
            <Badge variant="info">+{fmtMinor(item.sinkingFundMinor, currency)} reserve</Badge>
          )}
          {isOver && <Badge variant="danger">over</Badge>}
        </div>

        {!editing && (
          <span className="flex items-center gap-2 flex-shrink-0 tabular-nums text-sm">
            <span className={depth === 0 ? 'font-semibold text-gray-800' : 'text-gray-600'}>
              {fmtMinor(item.spentMinor, currency)}
            </span>
            {item.budgetMinor > 0 && <span className="text-gray-400">/ {fmtMinor(item.budgetMinor, currency)}</span>}
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
        <div className="flex items-center gap-2 mb-1.5">
          <span className="text-sm text-gray-400">{CURRENCY_SYMBOLS[currency] ?? currency}</span>
          <input
            type="number"
            step="0.01"
            min="0"
            autoFocus
            placeholder="0.00"
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
        <MagnitudeBar
          sizeRatio={sizeRatio}
          fillRatio={fillRatio}
          fillColor={fillColor}
          trackColor="bg-gray-300"
          small={depth > 0}
        />
      )}

      {hasChildren && isExpanded && (
        <div className="mt-2 ml-4 pl-3 border-l border-gray-200 space-y-2">
          {item.children.map((child) => (
            <BudgetGroup
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
    </>
  );

  if (depth === 0) {
    return (
      <div className="rounded-lg border border-gray-100 border-l-4 p-3" style={{ borderLeftColor: item.categoryColor ?? '#A0AEC0' }}>
        {content}
      </div>
    );
  }

  return <div>{content}</div>;
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

  const cadenceLabel: Record<SinkingFundCadence, string> = {
    annual: 'per year',
    semi: 'per 6 months',
    quarterly: 'per quarter',
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="text-base font-semibold text-gray-900 flex items-center gap-2">
          Annual / amortized expenses
          <Badge variant="info">sinking funds</Badge>
        </h2>
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
          <p className="text-sm text-gray-400 p-4">No annual / amortized expenses yet.</p>
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
                  type="number" step="0.01" min="0" autoFocus
                  placeholder="0.00"
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
