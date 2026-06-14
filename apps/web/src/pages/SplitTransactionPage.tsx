import { useState, useEffect, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, Button, CategoryPicker, type PickerCategory } from '@pfm/ui';
import { api, ApiException } from '../lib/api';

type Household = { id: string; name: string };

type SplitItem = { categoryId: string | null; amountMinor: number };
type TxDetail = {
  id: string; merchant: string | null; postedDate: string;
  amountMinor: number; currency: string; accountName: string;
  hasSplit: boolean;
  splits: Array<{ id: string; categoryId: string | null; categoryName: string | null; amountMinor: number }>;
};

type CategoryResponse = {
  id: string; parentId: string | null; name: string; color: string | null;
  isSystem: boolean; kind: string; children: CategoryResponse[];
};

const CURRENCY_SYMBOLS: Record<string, string> = { USD: '$', EUR: '€', GBP: '£', INR: '₹' };

function fmtAbs(minor: number, currency: string): string {
  const symbol = CURRENCY_SYMBOLS[currency] ?? currency;
  return `${symbol}${(Math.abs(minor) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtSigned(minor: number, currency: string): string {
  const symbol = CURRENCY_SYMBOLS[currency] ?? currency;
  const abs = (Math.abs(minor) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return minor >= 0 ? `+${symbol}${abs}` : `−${symbol}${abs}`;
}

function parseDollars(raw: string): number | null {
  const cleaned = raw.replace(/[$,\s]/g, '');
  if (cleaned === '' || cleaned === '.') return null;
  const n = parseFloat(cleaned);
  if (isNaN(n) || n < 0) return null;
  return Math.round(n * 100);
}

export function SplitTransactionPage() {
  const { txId } = useParams<{ txId: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const { data: household } = useQuery({
    queryKey: ['household'],
    queryFn: () => api.get<Household>('/households/me'),
  });

  const { data: tx, isLoading: txLoading } = useQuery({
    queryKey: ['tx', txId, household?.id],
    queryFn: () => api.get<TxDetail>(`/households/${household!.id}/transactions/${txId}`),
    enabled: !!household?.id && !!txId,
  });

  const { data: categories = [] } = useQuery({
    queryKey: ['categories', household?.id],
    queryFn: () => api.get<CategoryResponse[]>(`/households/${household!.id}/categories`),
    enabled: !!household?.id,
  });

  const pickerCategories: PickerCategory[] = useMemo(
    () => categories.map((c) => ({ id: c.id, name: c.name, color: c.color, children: (c.children ?? []).map((ch) => ({ id: ch.id, name: ch.name, color: ch.color })) })),
    [categories],
  );

  // Split rows: each has a categoryId and a raw dollar string the user types
  const [rows, setRows] = useState<Array<{ categoryId: string | null; raw: string }>>([]);
  const [saveError, setSaveError] = useState('');

  // Initialise rows from existing splits (or two empty rows for a fresh split)
  useEffect(() => {
    if (!tx) return;
    if (tx.hasSplit && tx.splits.length > 0) {
      setRows(tx.splits.map((s) => ({
        categoryId: s.categoryId,
        raw: (Math.abs(s.amountMinor) / 100).toFixed(2),
      })));
    } else {
      const total = (Math.abs(tx.amountMinor) / 100).toFixed(2);
      setRows([{ categoryId: null, raw: total }, { categoryId: null, raw: '' }]);
    }
  }, [tx?.id]);

  const totalMinor = tx ? Math.abs(tx.amountMinor) : 0;
  const allocatedMinor = rows.reduce((sum, r) => sum + (parseDollars(r.raw) ?? 0), 0);
  const remainingMinor = totalMinor - allocatedMinor;
  const isBalanced = remainingMinor === 0;
  const hasEnoughRows = rows.length >= 2 && rows.every((r) => parseDollars(r.raw) !== null && parseDollars(r.raw)! > 0);

  function updateRow(i: number, patch: Partial<typeof rows[0]>) {
    setRows((prev) => prev.map((r, idx) => idx === i ? { ...r, ...patch } : r));
  }

  function addRow() {
    const remaining = remainingMinor > 0 ? (remainingMinor / 100).toFixed(2) : '';
    setRows((prev) => [...prev, { categoryId: null, raw: remaining }]);
  }

  function removeRow(i: number) {
    setRows((prev) => prev.filter((_, idx) => idx !== i));
  }

  const splitMutation = useMutation({
    mutationFn: async () => {
      if (!household || !txId) throw new Error('Missing context');
      const splits: SplitItem[] = rows.map((r) => ({
        categoryId: r.categoryId,
        amountMinor: parseDollars(r.raw)!,
      }));
      return api.patch(`/households/${household.id}/transactions/${txId}/splits`, { splits });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['transactions'] });
      qc.invalidateQueries({ queryKey: ['tx', txId] });
      navigate('/transactions');
    },
    onError: (err) => setSaveError(err instanceof ApiException ? err.message : 'Failed to save splits.'),
  });

  const clearMutation = useMutation({
    mutationFn: async () => {
      if (!household || !txId) throw new Error('Missing context');
      return api.delete(`/households/${household.id}/transactions/${txId}/splits`);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['transactions'] });
      navigate('/transactions');
    },
    onError: (err) => setSaveError(err instanceof ApiException ? err.message : 'Failed to clear splits.'),
  });

  const currency = tx?.currency ?? 'USD';

  return (
    <div className="p-6 max-w-2xl space-y-5">

        {/* Header */}
        <div className="space-y-1">
          <button onClick={() => navigate('/transactions')} className="text-xs text-blue-600 hover:underline">
            ← Back to Transactions
          </button>
          <h1 className="text-xl font-semibold text-gray-900">Split transaction</h1>
          {tx && (
            <p className="text-sm text-gray-500">
              {tx.merchant ?? 'Unknown merchant'} · {tx.postedDate} · {tx.accountName}
            </p>
          )}
        </div>

        {txLoading && <p className="text-sm text-gray-400">Loading…</p>}

        {tx && (
          <>
            {/* Total bar */}
            <Card padding="md">
              <div className="flex items-center justify-between mb-3">
                <span className="text-sm font-medium text-gray-700">Transaction total</span>
                <span className="text-sm font-semibold text-gray-900 tabular-nums">
                  {fmtSigned(tx.amountMinor, currency)}
                </span>
              </div>
              <div className="h-2 rounded-full bg-gray-100 overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${allocatedMinor > totalMinor ? 'bg-red-500' : isBalanced ? 'bg-emerald-500' : 'bg-blue-500'}`}
                  style={{ width: `${Math.min(100, totalMinor > 0 ? (allocatedMinor / totalMinor) * 100 : 0)}%` }}
                />
              </div>
              <div className="flex justify-between mt-1.5 text-xs text-gray-500">
                <span>Allocated {fmtAbs(allocatedMinor, currency)}</span>
                {remainingMinor > 0 && <span className="text-amber-600">{fmtAbs(remainingMinor, currency)} remaining</span>}
                {remainingMinor < 0 && <span className="text-red-600">{fmtAbs(-remainingMinor, currency)} over</span>}
                {isBalanced && <span className="text-emerald-600">Fully allocated ✓</span>}
              </div>
            </Card>

            {/* Split rows */}
            <Card padding="none">
              <div className="divide-y divide-gray-100">
                {rows.map((row, i) => (
                  <div key={i} className="flex items-center gap-3 px-4 py-3">
                    <span className="text-xs text-gray-400 w-5 shrink-0 text-center">{i + 1}</span>

                    <div className="flex-1 min-w-0">
                      <CategoryPicker
                        categories={pickerCategories}
                        value={row.categoryId}
                        onChange={(id) => updateRow(i, { categoryId: id })}
                        placeholder="Pick a category"
                        allowUncategorized
                      />
                    </div>

                    <div className="relative w-32 shrink-0">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm select-none">
                        {CURRENCY_SYMBOLS[currency] ?? currency}
                      </span>
                      <input
                        type="text"
                        inputMode="decimal"
                        value={row.raw}
                        onChange={(e) => updateRow(i, { raw: e.target.value })}
                        onFocus={(e) => e.target.select()}
                        placeholder="0.00"
                        className="w-full pl-7 pr-3 py-1.5 text-sm border border-gray-200 rounded-lg text-right tabular-nums focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>

                    <button
                      onClick={() => removeRow(i)}
                      disabled={rows.length <= 2}
                      className="text-gray-300 hover:text-red-500 disabled:opacity-30 disabled:cursor-not-allowed shrink-0"
                      title="Remove split"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
                        <path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z" />
                      </svg>
                    </button>
                  </div>
                ))}
              </div>

              <div className="px-4 py-3 border-t border-gray-100">
                <button
                  onClick={addRow}
                  className="text-sm text-blue-600 hover:underline flex items-center gap-1"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
                    <path d="M10.75 4.75a.75.75 0 0 0-1.5 0v4.5h-4.5a.75.75 0 0 0 0 1.5h4.5v4.5a.75.75 0 0 0 1.5 0v-4.5h4.5a.75.75 0 0 0 0-1.5h-4.5v-4.5Z" />
                  </svg>
                  Add another split
                </button>
              </div>
            </Card>

            {saveError && <p className="text-sm text-red-600">{saveError}</p>}

            <div className="flex gap-2 flex-wrap">
              <Button
                onClick={() => splitMutation.mutate()}
                loading={splitMutation.isPending}
                disabled={!isBalanced || !hasEnoughRows}
              >
                Save splits
              </Button>
              {tx.hasSplit && (
                <Button
                  variant="secondary"
                  onClick={() => clearMutation.mutate()}
                  loading={clearMutation.isPending}
                >
                  Remove split
                </Button>
              )}
              <Button variant="secondary" onClick={() => navigate('/transactions')}>
                Cancel
              </Button>
            </div>

            <p className="text-xs text-gray-400 leading-relaxed">
              Splits must add up to the full transaction amount. Each portion can have its own
              category — both sides will count toward that category's spending in your budget.
            </p>
          </>
        )}
      </div>
  );
}
