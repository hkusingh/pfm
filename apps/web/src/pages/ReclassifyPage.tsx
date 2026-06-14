import { useState, useMemo } from 'react';
import { useParams, useSearchParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, Button, CategoryPicker, type PickerCategory } from '@pfm/ui';
import { api, ApiException } from '../lib/api';

type Household = { id: string; name: string };

type TransactionItem = {
  id: string;
  postedDate: string;
  merchant: string | null;
  amountMinor: number;
  currency: string;
  accountName: string;
  categoryId: string | null;
  categoryName: string | null;
  categoryColor: string | null;
};

type TxListResponse = { items: TransactionItem[]; total: number };

type CategoryResponse = {
  id: string;
  parentId: string | null;
  name: string;
  color: string | null;
  isSystem: boolean;
  kind: string;
  children: CategoryResponse[];
};

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
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function ReclassifyPage() {
  const { categoryId } = useParams<{ categoryId: string }>();
  const [searchParams] = useSearchParams();
  const categoryName = searchParams.get('name') ?? 'this category';
  const navigate = useNavigate();
  const qc = useQueryClient();

  const { data: household } = useQuery({
    queryKey: ['household'],
    queryFn: () => api.get<Household>('/households/me'),
  });

  // All transactions still assigned to this category
  const { data: txData, isLoading: txLoading } = useQuery({
    queryKey: ['reclassify-txns', categoryId, household?.id],
    queryFn: () =>
      api.get<TxListResponse>(
        `/households/${household!.id}/transactions?categoryId=${categoryId}&limit=200`,
      ),
    enabled: !!household?.id && !!categoryId,
  });

  const { data: categories = [] } = useQuery({
    queryKey: ['categories', household?.id],
    queryFn: () => api.get<CategoryResponse[]>(`/households/${household!.id}/categories`),
    enabled: !!household?.id,
  });

  const pickerCategories: PickerCategory[] = useMemo(
    () =>
      categories.map((c) => ({
        id: c.id,
        name: c.name,
        color: c.color,
        children: (c.children ?? []).map((ch) => ({ id: ch.id, name: ch.name, color: ch.color })),
      })),
    [categories],
  );

  // Selection + reassign target state
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [reassignTo, setReassignTo] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [reassignError, setReassignError] = useState('');
  const [deleteError, setDeleteError] = useState('');

  const transactions = txData?.items ?? [];
  const allSelected = transactions.length > 0 && selected.size === transactions.length;

  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(transactions.map((t) => t.id)));
  }

  function toggleOne(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) { next.delete(id); } else { next.add(id); }
      return next;
    });
  }

  // Reassign selected transactions in batches of 10
  const reassignMutation = useMutation({
    mutationFn: async () => {
      if (!household) throw new Error('No household');
      const ids = [...selected];
      const BATCH = 10;
      let done = 0;
      setProgress({ done: 0, total: ids.length });
      setReassignError('');

      for (let i = 0; i < ids.length; i += BATCH) {
        const batch = ids.slice(i, i + BATCH);
        await Promise.all(
          batch.map((txId) =>
            api.patch(`/households/${household.id}/transactions/${txId}/category`, {
              categoryId: reassignTo,
              createRule: false,
            }),
          ),
        );
        done += batch.length;
        setProgress({ done, total: ids.length });
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['reclassify-txns'] });
      qc.invalidateQueries({ queryKey: ['transactions'] });
      setSelected(new Set());
      setProgress(null);
    },
    onError: (err) => {
      setReassignError(err instanceof ApiException ? err.message : 'Failed to reassign.');
      setProgress(null);
    },
  });

  // Delete the now-empty category
  const deleteMutation = useMutation({
    mutationFn: async () => {
      if (!household || !categoryId) throw new Error('No target');
      return api.delete(`/households/${household.id}/categories/${categoryId}`, { reassignTo: null });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['categories'] });
      navigate('/categories');
    },
    onError: (err) => setDeleteError(err instanceof ApiException ? err.message : 'Failed to delete.'),
  });

  return (
    <div className="p-6 max-w-4xl space-y-5">

        {/* Header */}
        <div className="space-y-1">
          <button
            onClick={() => navigate('/categories')}
            className="text-xs text-blue-600 hover:underline flex items-center gap-1"
          >
            ← Back to Categories
          </button>
          <h1 className="text-xl font-semibold text-gray-900">
            Reclassify before deleting &ldquo;{categoryName}&rdquo;
          </h1>
          <p className="text-sm text-gray-500">
            {transactions.length > 0
              ? `${transactions.length} transaction${transactions.length !== 1 ? 's' : ''} are assigned to this category. Reassign them before the category can be deleted.`
              : 'All transactions have been reassigned. You can now delete the category.'}
          </p>
        </div>

        {transactions.length > 0 && (
          <Card padding="none">
            {/* Bulk reassign toolbar */}
            <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-100 bg-gray-50 rounded-t-xl">
              <span className="text-xs text-gray-500">
                {selected.size > 0 ? `${selected.size} selected` : 'Select transactions to reassign'}
              </span>
              <div className="flex-1" />
              <div className="w-52">
                <CategoryPicker
                  categories={pickerCategories}
                  value={reassignTo}
                  onChange={setReassignTo}
                  placeholder="Pick a category"
                />
              </div>
              <Button
                onClick={() => reassignMutation.mutate()}
                loading={reassignMutation.isPending}
                disabled={selected.size === 0}
              >
                Reassign selected
              </Button>
            </div>

            {/* Progress bar */}
            {progress && (
              <div className="px-4 py-2 bg-blue-50 border-b border-blue-100 text-xs text-blue-700">
                Reassigning… {progress.done} of {progress.total}
              </div>
            )}

            {reassignError && (
              <div className="px-4 py-2 bg-red-50 border-b border-red-100 text-xs text-red-700">
                {reassignError}
              </div>
            )}

            {/* Transaction table */}
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100">
                  <th className="w-10 px-4 py-2.5">
                    <input
                      type="checkbox"
                      checked={allSelected}
                      onChange={toggleAll}
                      className="rounded border-gray-300"
                    />
                  </th>
                  <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500 uppercase tracking-wide">Date</th>
                  <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500 uppercase tracking-wide">Merchant</th>
                  <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500 uppercase tracking-wide">Account</th>
                  <th className="px-4 py-2.5 text-right text-xs font-medium text-gray-500 uppercase tracking-wide">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {txLoading && (
                  <tr>
                    <td colSpan={5} className="px-4 py-6 text-sm text-gray-400 text-center">Loading…</td>
                  </tr>
                )}
                {transactions.map((tx) => (
                  <tr
                    key={tx.id}
                    className={`hover:bg-gray-50 cursor-pointer ${selected.has(tx.id) ? 'bg-blue-50' : ''}`}
                    onClick={() => toggleOne(tx.id)}
                  >
                    <td className="px-4 py-2.5">
                      <input
                        type="checkbox"
                        checked={selected.has(tx.id)}
                        onChange={() => toggleOne(tx.id)}
                        onClick={(e) => e.stopPropagation()}
                        className="rounded border-gray-300"
                      />
                    </td>
                    <td className="px-4 py-2.5 text-gray-500 text-xs whitespace-nowrap">
                      {formatDate(tx.postedDate)}
                    </td>
                    <td className="px-4 py-2.5 text-gray-900 max-w-[220px] truncate">
                      {tx.merchant ?? <span className="text-gray-400 italic">No merchant</span>}
                    </td>
                    <td className="px-4 py-2.5 text-gray-500 text-xs">{tx.accountName}</td>
                    <td className={`px-4 py-2.5 text-right font-medium tabular-nums ${
                      tx.amountMinor >= 0 ? 'text-emerald-600' : 'text-gray-900'
                    }`}>
                      {formatAmount(tx.amountMinor, tx.currency)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        )}

        {/* Delete section — only shown when all transactions are cleared */}
        {!txLoading && transactions.length === 0 && (
          <Card padding="md">
            <p className="text-sm font-medium text-gray-900 mb-1">Ready to delete</p>
            <p className="text-xs text-gray-500 mb-4">
              No transactions remain in &ldquo;{categoryName}&rdquo;. You can safely delete it now.
            </p>
            {deleteError && <p className="text-xs text-red-600 mb-3">{deleteError}</p>}
            <div className="flex gap-2">
              <button
                onClick={() => deleteMutation.mutate()}
                disabled={deleteMutation.isPending}
                className="px-4 py-2 text-sm font-medium bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50"
              >
                {deleteMutation.isPending ? 'Deleting…' : `Delete "${categoryName}"`}
              </button>
              <button
                onClick={() => navigate('/categories')}
                className="px-4 py-2 text-sm font-medium border border-gray-300 rounded-lg hover:bg-gray-50"
              >
                Cancel
              </button>
            </div>
          </Card>
        )}

      </div>
  );
}
