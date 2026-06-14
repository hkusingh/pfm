import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Card, Button, Badge } from '@pfm/ui';
import { api } from '../lib/api';
import type { BudgetSummaryItem, BudgetSummaryResponse, IncomeSummaryResponse } from '@pfm/contracts';

type Household = { id: string; name: string };
type Category = { id: string; name: string; kind: 'expense' | 'income' | 'transfer'; children?: Category[] };

const CURRENCY_SYMBOLS: Record<string, string> = { USD: '$', EUR: '€', GBP: '£', INR: '₹' };

function fmtMinor(minor: number, currency: string): string {
  const symbol = CURRENCY_SYMBOLS[currency] ?? currency + ' ';
  const sign = minor < 0 ? '-' : '';
  return `${sign}${symbol}${(Math.abs(minor) / 100).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

function minorToInputOrEmpty(minor: number): string {
  return minor === 0 ? '' : (minor / 100).toFixed(2);
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

function spentColor(spentMinor: number, budgetMinor: number): string {
  if (budgetMinor <= 0) return 'bg-gray-300';
  const ratio = spentMinor / budgetMinor;
  if (ratio > 1) return 'bg-red-500';
  if (ratio >= 0.8) return 'bg-amber-500';
  return 'bg-blue-500';
}

// ─── Magnitude bar ────────────────────────────────────────────────────────────

function MagnitudeBar({ sizeRatio, fillRatio, fillColor, small }: {
  sizeRatio: number; fillRatio: number; fillColor: string; small?: boolean;
}) {
  const size = Math.max(2, Math.min(100, sizeRatio * 100));
  const fill = Math.max(0, Math.min(100, fillRatio * 100));
  return (
    <div className={`w-full ${small ? 'h-3.5' : 'h-5'} rounded-md bg-gray-50 border border-gray-100 overflow-hidden`}>
      <div className="h-full rounded-md bg-gray-200" style={{ width: `${size}%` }}>
        <div className={`h-full rounded-md ${fillColor}`} style={{ width: `${fill}%` }} />
      </div>
    </div>
  );
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
  const [showAll, setShowAll] = useState(false);

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

  const categoriesQ = useQuery({
    queryKey: ['categories', hid],
    queryFn: () => api.get<Category[]>(`/households/${hid}/categories`),
    enabled: !!hid,
  });

  const currency = summaryQ.data?.currency ?? 'USD';

  const upsertMutation = useMutation({
    mutationFn: (vars: { categoryId: string; amountMinor: number }) =>
      api.put(`/households/${hid}/budgets`, { categoryId: vars.categoryId, period, amountMinor: vars.amountMinor }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['budget-summary', hid, period] }),
  });

  const deleteMutation = useMutation({
    mutationFn: (budgetId: string) => api.delete(`/households/${hid}/budgets/${budgetId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['budget-summary', hid, period] }),
  });

  function toggleExpanded(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  const VISIBLE_COUNT = 5;

  const allItems = summaryQ.data?.items ?? [];
  // Active: has spend, budget, or reserve. Sort by max(budget, spend) desc.
  const activeItems = allItems
    .filter((i) => i.budgetMinor > 0 || i.spentMinor > 0 || i.sinkingFundMinor > 0)
    .sort((a, b) => Math.max(b.budgetMinor, b.spentMinor) - Math.max(a.budgetMinor, a.spentMinor));
  const visibleItems = showAll ? activeItems : activeItems.slice(0, VISIBLE_COUNT);
  const hiddenCount = Math.max(0, activeItems.length - VISIBLE_COUNT);
  const maxBudget = Math.max(1, ...activeItems.map((i) => i.budgetMinor));

  // Count categories with no budget at all (no default, no override)
  const unbudgetedCount = allItems.filter(
    (i) => !i.defaultBudgetId && !i.hasMonthOverride && i.spentMinor === 0 && i.sinkingFundMinor === 0,
  ).length;

  // Income (only received items come back from the server)
  const topLevelIncomeIds = new Set((categoriesQ.data ?? []).filter((c) => c.kind === 'income').map((c) => c.id));
  const allIncomeItems = incomeQ.data?.items ?? [];
  const incomeChildItems = allIncomeItems.filter((i) => !topLevelIncomeIds.has(i.categoryId));
  const incomeItems = incomeChildItems.length > 0 ? incomeChildItems : allIncomeItems;
  const incomeReceivedTotal = incomeItems.reduce((s, i) => s + i.receivedMinor, 0);

  return (
    <div className="p-6 space-y-6 max-w-4xl">

      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h1 className="text-2xl font-semibold text-gray-900">Budgets — {periodLabel(period)}</h1>
        <div className="flex items-center gap-2">
          <button
            onClick={() => { setPeriod((p) => shiftPeriod(p, -1)); setShowAll(false); }}
            className="w-8 h-8 flex items-center justify-center rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50"
          >‹</button>
          <span className="text-sm font-medium text-gray-700 w-36 text-center">{periodLabel(period)}</span>
          <button
            onClick={() => { setPeriod((p) => shiftPeriod(p, 1)); setShowAll(false); }}
            className="w-8 h-8 flex items-center justify-center rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50"
          >›</button>
          <Button variant="secondary" size="sm" onClick={() => navigate('/budgets/manage')}>
            ⚙ Manage budget
          </Button>
        </div>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-500">
        <span><b className="text-gray-700">Bar length</b> = relative budget size</span>
        <span className="flex items-center gap-1.5"><span className="inline-block w-2.5 h-2.5 rounded-sm bg-blue-500" /> on track</span>
        <span className="flex items-center gap-1.5"><span className="inline-block w-2.5 h-2.5 rounded-sm bg-amber-500" /> near limit</span>
        <span className="flex items-center gap-1.5"><span className="inline-block w-2.5 h-2.5 rounded-sm bg-red-500" /> over budget</span>
      </div>

      {/* Budget summary */}
      <Card padding="md">
        {summaryQ.isLoading || incomeQ.isLoading ? (
          <p className="text-sm text-gray-400">Loading…</p>
        ) : (
          <div className="space-y-3">

            {/* Income received */}
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
                      <span className="text-xs text-gray-400 font-normal">{incomeItems.length} source{incomeItems.length !== 1 ? 's' : ''}</span>
                    </button>
                    <span className="text-sm tabular-nums flex-shrink-0 font-semibold text-emerald-600">
                      {fmtMinor(incomeReceivedTotal, currency)} received
                    </span>
                  </div>
                  <div className="h-2 w-full rounded-full bg-emerald-100">
                    <div className="h-full rounded-full bg-emerald-500" style={{ width: '100%' }} />
                  </div>
                  {expanded.has('__income__') && (
                    <div className="mt-2 ml-4 pl-3 border-l border-emerald-100 space-y-1.5">
                      {incomeItems.map((item) => (
                        <div key={item.categoryId} className="flex items-center justify-between text-xs">
                          <span className="text-gray-600 font-medium truncate">{item.categoryName}</span>
                          <span className="tabular-nums text-emerald-600 font-medium ml-2 flex-shrink-0">
                            {fmtMinor(item.receivedMinor, currency)}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <p className="text-xs text-gray-400 px-1">↑ Income received this month. Budgets below track spending.</p>
              </>
            )}

            {/* Expense categories */}
            {activeItems.length === 0 ? (
              <div className="py-8 text-center space-y-2">
                <p className="text-sm text-gray-400">No spending or budgets for {periodLabel(period)}.</p>
                <button
                  onClick={() => navigate('/budgets/manage')}
                  className="text-sm text-blue-600 hover:underline"
                >
                  Set up default budgets →
                </button>
              </div>
            ) : (
              <>
                {visibleItems.map((item) => (
                  <BudgetTrackRow
                    key={item.categoryId}
                    item={item}
                    currency={currency}
                    maxBudget={maxBudget}
                    period={period}
                    depth={0}
                    expanded={expanded}
                    onToggle={toggleExpanded}
                    onSaveOverride={(categoryId, amountMinor) =>
                      upsertMutation.mutate({ categoryId, amountMinor })
                    }
                    onDeleteOverride={(budgetId) => deleteMutation.mutate(budgetId)}
                  />
                ))}
                {!showAll && hiddenCount > 0 && (
                  <button
                    onClick={() => setShowAll(true)}
                    className="w-full py-2 text-sm text-blue-600 hover:underline text-center border-t border-gray-100 mt-1"
                  >
                    Show {hiddenCount} more {hiddenCount === 1 ? 'category' : 'categories'}
                  </button>
                )}
                {showAll && activeItems.length > VISIBLE_COUNT && (
                  <button
                    onClick={() => setShowAll(false)}
                    className="w-full py-2 text-sm text-gray-400 hover:text-gray-600 text-center border-t border-gray-100 mt-1"
                  >
                    Show less
                  </button>
                )}
              </>
            )}

            {/* Unbudgeted categories hint */}
            {unbudgetedCount > 0 && (
              <p className="text-xs text-gray-400 pt-1 border-t border-gray-100">
                {unbudgetedCount} {unbudgetedCount === 1 ? 'category has' : 'categories have'} no budget set.{' '}
                <button onClick={() => navigate('/budgets/manage')} className="text-blue-600 hover:underline">
                  Set defaults →
                </button>
              </p>
            )}
          </div>
        )}
      </Card>

      <div className="rounded-lg border-l-4 border-l-emerald-400 bg-emerald-50 px-4 py-3 text-sm text-gray-600">
        <b className="text-gray-800">Monthly overrides</b> apply only to {periodLabel(period)}. To change the default for all months, use{' '}
        <button onClick={() => navigate('/budgets/manage')} className="text-blue-700 hover:underline font-medium">
          Manage budget
        </button>.
      </div>
    </div>
  );
}

// ─── Budget tracking row (current-month view only) ────────────────────────────

function BudgetTrackRow({
  item, currency, maxBudget, period, depth, expanded, onToggle, onSaveOverride, onDeleteOverride,
}: {
  item: BudgetSummaryItem;
  currency: string;
  maxBudget: number;
  period: string;
  depth: number;
  expanded: Set<string>;
  onToggle: (id: string) => void;
  onSaveOverride: (categoryId: string, amountMinor: number) => void;
  onDeleteOverride: (budgetId: string) => void;
}) {
  // Only show children with budget or spend in the tracking view.
  const activeChildren = item.children.filter(
    (c) => c.budgetMinor > 0 || c.spentMinor > 0 || c.sinkingFundMinor > 0,
  );
  const childrenBudgetMinor = activeChildren.reduce((s, c) => s + c.budgetMinor, 0);
  const ownBudgetMinor = item.budgetMinor - item.sinkingFundMinor - childrenBudgetMinor;

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');

  const hasChildren = activeChildren.length > 0;
  const isExpanded = expanded.has(item.categoryId);
  const sizeRatio = maxBudget > 0 ? item.budgetMinor / maxBudget : 0;
  const fillRatio = item.budgetMinor > 0 ? item.spentMinor / item.budgetMinor : 0;
  const fillColor = spentColor(item.spentMinor, item.budgetMinor);
  const isOver = item.budgetMinor > 0 && item.spentMinor > item.budgetMinor;
  const monthName = periodLabel(period);

  function startEdit() {
    setDraft(minorToInputOrEmpty(ownBudgetMinor));
    setEditing(true);
  }

  function save() {
    const newMinor = inputToMinor(draft);
    onSaveOverride(item.categoryId, newMinor);
    setEditing(false);
  }

  const content = (
    <>
      <div className="flex items-start justify-between gap-2 mb-1.5">
        <div className="flex items-center gap-2 min-w-0">
          {hasChildren ? (
            <button onClick={() => onToggle(item.categoryId)} className="flex-shrink-0">
              <Chevron expanded={isExpanded} />
            </button>
          ) : (
            <span className="w-5 flex-shrink-0" />
          )}
          <span
            className="inline-block w-2.5 h-2.5 rounded-full flex-shrink-0"
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
          {item.hasMonthOverride && <Badge variant="default">override</Badge>}
        </div>

        {!editing && (
          <div className="flex flex-col items-end gap-0.5 flex-shrink-0">
            <span className="flex items-center gap-1.5 tabular-nums text-sm">
              <span className={depth === 0 ? 'font-semibold text-gray-800' : 'text-gray-600'}>
                {fmtMinor(item.spentMinor, currency)}
              </span>
              {item.budgetMinor > 0 && (
                <span className="text-gray-400">/ {fmtMinor(item.budgetMinor, currency)}</span>
              )}
            </span>

            <span className="flex items-center gap-2 text-xs">
              {item.hasMonthOverride ? (
                <>
                  <button onClick={startEdit} className="text-blue-600 hover:underline">Edit override</button>
                  <button onClick={() => onDeleteOverride(item.budgetId!)} className="text-gray-400 hover:text-red-500">
                    Clear
                  </button>
                </>
              ) : item.defaultBudgetId ? (
                <button onClick={startEdit} className="text-gray-500 hover:text-blue-600">
                  Override for {monthName}
                </button>
              ) : item.spentMinor > 0 ? (
                <button
                  onClick={() => window.location.assign('/budgets/manage')}
                  className="text-gray-400 hover:text-blue-600"
                >
                  Set budget →
                </button>
              ) : null}
            </span>
          </div>
        )}
      </div>

      {editing ? (
        <div className="mb-1.5 space-y-1">
          <p className="text-xs text-gray-500">Override budget for {monthName} only</p>
          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-400">{CURRENCY_SYMBOLS[currency] ?? currency}</span>
            <input
              type="number" step="0.01" min="0" autoFocus placeholder="0.00"
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
        </div>
      ) : item.budgetMinor > 0 ? (
        <MagnitudeBar
          sizeRatio={sizeRatio}
          fillRatio={fillRatio}
          fillColor={fillColor}
          small={depth > 0}
        />
      ) : (
        <p className="text-xs text-gray-300 italic">No budget set for this category</p>
      )}

      {hasChildren && isExpanded && (
        <div className="mt-2 ml-4 pl-3 border-l border-gray-200 space-y-2">
          {activeChildren.map((child) => (
            <BudgetTrackRow
              key={child.categoryId}
              item={child}
              currency={currency}
              maxBudget={maxBudget}
              period={period}
              depth={depth + 1}
              expanded={expanded}
              onToggle={onToggle}
              onSaveOverride={onSaveOverride}
              onDeleteOverride={onDeleteOverride}
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
