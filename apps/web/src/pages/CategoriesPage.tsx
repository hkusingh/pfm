import { useState, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Button, Card } from '@pfm/ui';
import { api, ApiException } from '../lib/api';

type Household = { id: string; name: string };

type Category = {
  id: string;
  parentId: string | null;
  name: string;
  color: string | null;
  sortOrder: number;
  isSystem: boolean;
  kind: 'expense' | 'income' | 'transfer';
  children: Category[];
};

const PRESET_COLORS = [
  '#2F855A', '#E53E3E', '#2E6DA4', '#B9770E',
  '#8e44ad', '#7c8aa0', '#319795', '#1F8A4C',
  '#F6AD55', '#D53F8C',
];

function ColorDot({ color }: { color: string | null }) {
  return (
    <span
      className="inline-block w-3 h-3 rounded-full flex-shrink-0"
      style={{ background: color ?? '#A0AEC0' }}
    />
  );
}

export function CategoriesPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();

  const { data: household } = useQuery({
    queryKey: ['household'],
    queryFn: () => api.get<Household>('/households/me'),
  });
  const { data: categories = [], isLoading } = useQuery({
    queryKey: ['categories', household?.id],
    queryFn: () => api.get<Category[]>(`/households/${household!.id}/categories`),
    enabled: !!household?.id,
  });

  // ── Add / edit form ──────────────────────────────────────────────────────

  const [editingId, setEditingId] = useState<string | null>(null);
  const [formName, setFormName] = useState('');
  const [formParentId, setFormParentId] = useState<string>('');
  const [formColor, setFormColor] = useState(PRESET_COLORS[0]);
  const [formKind, setFormKind] = useState<'expense' | 'income' | 'transfer'>('expense');
  const [formError, setFormError] = useState('');

  function openAdd(parentId?: string, kind?: 'expense' | 'income' | 'transfer') {
    setEditingId(null);
    setFormName('');
    setFormParentId(parentId ?? '');
    setFormColor(PRESET_COLORS[0]);
    setFormKind(kind ?? 'expense');
    setFormError('');
  }

  function openEdit(cat: Category) {
    setEditingId(cat.id);
    setFormName(cat.name);
    setFormParentId(cat.parentId ?? '');
    setFormColor(cat.color ?? PRESET_COLORS[0]);
    setFormKind(cat.kind);
    setFormError('');
  }

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!household) throw new Error('No household');
      const body = {
        name: formName,
        parentId: formParentId || undefined,
        color: formColor,
        kind: formKind,
      };
      if (editingId) {
        return api.patch(`/households/${household.id}/categories/${editingId}`, body);
      }
      return api.post(`/households/${household.id}/categories`, body);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['categories'] });
      setEditingId(null);
      setFormName('');
      setFormError('');
    },
    onError: (err) => setFormError(err instanceof ApiException ? err.message : 'Failed to save.'),
  });

  // ── Delete ───────────────────────────────────────────────────────────────

  const [deletingCat, setDeletingCat] = useState<Category | null>(null);
  const [deleteError, setDeleteError] = useState('');

  function openDeletePanel(cat: Category) {
    setDeletingCat(cat);
    setDeleteError('');
  }

  function closeDeletePanel() {
    setDeletingCat(null);
    setDeleteError('');
  }

  const deleteMutation = useMutation({
    mutationFn: async () => {
      if (!household || !deletingCat) throw new Error('No target');
      return api.delete(`/households/${household.id}/categories/${deletingCat.id}`, {});
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['categories'] });
      closeDeletePanel();
    },
    onError: (err) => {
      if (err instanceof ApiException && err.message.includes('CATEGORY_HAS_TRANSACTIONS')) {
        // Navigate to the reclassify page — the user handles reassignment there before deleting.
        navigate(
          `/categories/${deletingCat!.id}/reclassify?name=${encodeURIComponent(deletingCat!.name)}`,
        );
        closeDeletePanel();
      } else {
        setDeleteError(err instanceof ApiException ? err.message : 'Failed to delete.');
      }
    },
  });

  // Permanent structural blocker (has children / is system) — hide the Delete button.
  const deleteIsBlocked =
    deleteError.toLowerCase().includes('sub-categor') ||
    deleteError.toLowerCase().includes('system categor');

  // All parent categories (top-level) available for reassign or as parent selector
  const topLevel = categories.filter((c) => !c.parentId);

  // Flat list of all categories for reassign dropdown
  const allFlat: Category[] = [];
  for (const p of categories) {
    allFlat.push(p);
    for (const ch of p.children ?? []) allFlat.push(ch);
  }

  const formIsOpen = formName !== '' || editingId !== null;

  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const collapsedInitialized = useRef(false);
  useEffect(() => {
    if (!collapsedInitialized.current && categories.length > 0) {
      setCollapsed(new Set(categories.map((c) => c.id)));
      collapsedInitialized.current = true;
    }
  }, [categories]);

  function toggleCollapsed(id: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) { next.delete(id); } else { next.add(id); }
      return next;
    });
  }

  return (
    <>
    <div className="p-6 max-w-5xl space-y-5">

        {/* Page header */}
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-semibold text-gray-900">Manage categories</h1>
          <Button onClick={() => openAdd()}>+ Add category</Button>
        </div>

        {isLoading ? (
          <p className="text-sm text-gray-400">Loading…</p>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-[1.5fr_1fr] gap-5 items-start">

            {/* Left — category tree table */}
            <Card padding="none">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100">
                    <th className="w-7 px-3 py-2.5" />
                    <th className="px-3 py-2.5 text-left font-medium text-gray-500 text-xs uppercase tracking-wide">Category</th>
                    <th className="px-3 py-2.5 text-left font-medium text-gray-500 text-xs uppercase tracking-wide">Type</th>
                    <th className="px-3 py-2.5 text-right font-medium text-gray-500 text-xs uppercase tracking-wide">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {categories.map((cat) => (
                    <>
                      {/* Parent row */}
                      <tr key={cat.id} className="hover:bg-gray-50">
                        <td className="px-3 py-2.5 text-center w-8">
                          {(cat.children ?? []).length > 0 && (
                            <button
                              onClick={() => toggleCollapsed(cat.id)}
                              className="w-5 h-5 flex items-center justify-center rounded text-gray-500 hover:text-gray-800 hover:bg-gray-100"
                              style={{ transform: collapsed.has(cat.id) ? 'rotate(-90deg)' : 'rotate(0deg)', transition: 'transform 150ms' }}
                            >
                              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                                <path d="M3 5l4 4 4-4" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"/>
                              </svg>
                            </button>
                          )}
                        </td>
                        <td className="px-3 py-2.5">
                          <span className="flex items-center gap-2">
                            <ColorDot color={cat.color} />
                            <span className="font-medium text-gray-900">{cat.name}</span>
                            {cat.isSystem && (
                              <span className="text-[10px] font-semibold bg-blue-50 text-blue-600 border border-blue-200 px-1.5 py-0.5 rounded-full">
                                system
                              </span>
                            )}
                          </span>
                        </td>
                        <td className="px-3 py-2.5 text-gray-400 text-xs">
                          {cat.parentId ? 'sub' : 'parent'}{cat.kind !== 'expense' ? ` · ${cat.kind}` : ''}
                        </td>
                        <td className="px-3 py-2.5 text-right">
                          {cat.isSystem ? (
                            <span className="text-gray-300 text-xs">protected</span>
                          ) : (
                            <span className="flex items-center justify-end gap-3">
                              <button
                                onClick={() => openEdit(cat)}
                                className="text-xs text-blue-600 hover:underline"
                              >
                                Rename
                              </button>
                              <button
                                onClick={() => {
                                  openEdit(cat);
                                  // Switch to color picker focus
                                }}
                                className="text-xs text-blue-600 hover:underline"
                              >
                                Color
                              </button>
                              <button
                                onClick={() => openDeletePanel(cat)}
                                className="text-xs text-red-500 hover:text-red-700"
                              >
                                Delete
                              </button>
                            </span>
                          )}
                        </td>
                      </tr>

                      {/* Sub-category rows + add link — hidden when collapsed */}
                      {!collapsed.has(cat.id) && (cat.children ?? []).map((child) => (
                        <tr key={child.id} className="hover:bg-gray-50">
                          <td className="px-3 py-2" />
                          <td className="px-3 py-2 pl-10 text-gray-500">
                            <span className="flex items-center gap-1.5">
                              <span className="text-gray-300 text-xs">↳</span>
                              {child.name}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-gray-400 text-xs">
                            sub{child.kind !== 'expense' ? ` · ${child.kind}` : ''}
                          </td>
                          <td className="px-3 py-2 text-right">
                            <span className="flex items-center justify-end gap-3">
                              <button
                                onClick={() => openEdit(child)}
                                className="text-xs text-blue-600 hover:underline"
                              >
                                Rename
                              </button>
                              <button
                                onClick={() => openDeletePanel(child)}
                                className="text-xs text-red-500 hover:text-red-700"
                              >
                                Delete
                              </button>
                            </span>
                          </td>
                        </tr>
                      ))}

                      {!collapsed.has(cat.id) && (
                        <tr key={`${cat.id}-add`} className="hover:bg-gray-50">
                          <td className="px-3 py-1.5" />
                          <td className="px-3 py-1.5 pl-10" colSpan={3}>
                            <button
                              onClick={() => openAdd(cat.id, cat.kind)}
                              className="text-xs text-blue-500 hover:underline"
                            >
                              + Add {cat.kind === 'income' ? 'income ' : ''}sub-category
                            </button>
                          </td>
                        </tr>
                      )}
                    </>
                  ))}

                  {categories.length === 0 && (
                    <tr>
                      <td colSpan={4} className="px-5 py-6 text-sm text-gray-400 text-center">
                        No categories yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </Card>

            {/* Right column — add/edit form */}
            <div className="space-y-4">

              {/* Add / edit form */}
              <Card padding="md">
                <p className="text-sm font-semibold text-gray-900 mb-4">
                  {editingId ? 'Edit category' : 'Add category'}
                </p>
                <form
                  onSubmit={(e) => { e.preventDefault(); saveMutation.mutate(); }}
                  className="space-y-3"
                >
                  <div className="space-y-1">
                    <label className="block text-sm font-medium text-gray-700">Name</label>
                    <input
                      type="text"
                      value={formName}
                      onChange={(e) => setFormName(e.target.value)}
                      required
                      placeholder="e.g. Food"
                      className="block w-full h-[38px] rounded-lg border border-gray-300 px-3 text-sm"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="block text-sm font-medium text-gray-700">
                      Parent <span className="font-normal text-gray-400">(optional)</span>
                    </label>
                    <select
                      value={formParentId}
                      onChange={(e) => setFormParentId(e.target.value)}
                      className="block w-full h-[38px] rounded-lg border border-gray-300 px-3 text-sm"
                    >
                      <option value="">— None (top-level) —</option>
                      {topLevel.map((p) => (
                        <option key={p.id} value={p.id}>{p.name}</option>
                      ))}
                    </select>
                  </div>

                  {!formParentId && (
                    <div className="space-y-1">
                      <label className="block text-sm font-medium text-gray-700">Type</label>
                      <select
                        value={formKind}
                        onChange={(e) => setFormKind(e.target.value as 'expense' | 'income' | 'transfer')}
                        className="block w-full h-[38px] rounded-lg border border-gray-300 px-3 text-sm"
                      >
                        <option value="expense">Expense</option>
                        <option value="income">Income</option>
                        <option value="transfer">Transfer</option>
                      </select>
                    </div>
                  )}

                  <div className="space-y-1.5">
                    <label className="block text-sm font-medium text-gray-700">Color</label>
                    <div className="flex flex-wrap gap-2">
                      {PRESET_COLORS.map((c) => (
                        <button
                          key={c}
                          type="button"
                          onClick={() => setFormColor(c)}
                          className="w-6 h-6 rounded-md flex-shrink-0 transition-transform hover:scale-110"
                          style={{
                            background: c,
                            outline: formColor === c ? `2px solid ${c}` : undefined,
                            outlineOffset: formColor === c ? '2px' : undefined,
                          }}
                        />
                      ))}
                    </div>
                  </div>

                  {formError && <p className="text-xs text-red-600">{formError}</p>}

                  <div className="flex gap-2 pt-1">
                    <Button type="submit" loading={saveMutation.isPending}>
                      Save category
                    </Button>
                    {(formIsOpen || editingId) && (
                      <Button
                        type="button"
                        variant="secondary"
                        onClick={() => { setEditingId(null); setFormName(''); setFormError(''); }}
                      >
                        Cancel
                      </Button>
                    )}
                  </div>
                </form>
              </Card>
            </div>

          </div>
        )}

        <div className="text-xs text-gray-400 leading-relaxed max-w-2xl">
          <strong className="text-gray-600">Safe deletion:</strong> deleting a category with
          transactions always prompts to reassign or merge them first. Core categories (e.g.
          Income) are protected and can&rsquo;t be deleted. Drag the{' '}
          <span className="font-mono">⋮⋮</span> handle to reorder.
        </div>

      </div>
      {/* Delete confirmation modal — fixed in viewport so scrolling doesn't matter */}
      {deletingCat && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
          onClick={closeDeletePanel}
        >
          <div
            className="bg-white rounded-xl shadow-xl w-full max-w-sm mx-4 p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="text-sm font-semibold text-gray-900 mb-1">
              Delete &ldquo;{deletingCat.name}&rdquo;?
            </p>

            {deleteIsBlocked ? (
              <p className="text-xs text-red-600 mt-2 mb-4">{deleteError}</p>
            ) : (
              <p className="text-xs text-gray-500 mt-2 mb-4">
                This will permanently delete the category.
                {deleteMutation.isPending && ' Checking for transactions…'}
              </p>
            )}

            <div className="flex gap-2">
              {!deleteIsBlocked && (
                <button
                  onClick={() => deleteMutation.mutate()}
                  disabled={deleteMutation.isPending}
                  className="px-3 py-1.5 text-xs font-medium bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50"
                >
                  {deleteMutation.isPending ? 'Checking…' : 'Delete'}
                </button>
              )}
              <button
                onClick={closeDeletePanel}
                className="px-3 py-1.5 text-xs font-medium border border-gray-300 rounded-lg hover:bg-gray-50"
              >
                {deleteIsBlocked ? 'Close' : 'Cancel'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
