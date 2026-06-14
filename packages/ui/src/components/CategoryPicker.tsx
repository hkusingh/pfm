import { useState, useEffect, useRef, useMemo } from 'react';

export type PickerCategory = {
  id: string;
  name: string;
  color?: string | null;
  kind?: string | null;
  children?: PickerCategory[];
};

type Props = {
  categories: PickerCategory[];
  value: string | null;
  onChange: (id: string | null) => void;
  placeholder?: string;
  allowUncategorized?: boolean;
  className?: string;
};

// ── CategoryFilterPicker — hierarchical multi-select filter for transaction lists ─
// values=[] means "All categories" (no filter).
// Selecting a parent implicitly includes all its children (API handles expansion).
// "All expenses" selects every top-level expense category and its children.

type FilterProps = {
  categories: PickerCategory[];
  values: string[];
  onChange: (ids: string[]) => void;
  className?: string;
};

export function CategoryFilterPicker({ categories, values, onChange, className }: FilterProps) {
  const [open, setOpen] = useState(false);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const ref = useRef<HTMLDivElement>(null);

  const expenseIds = useMemo(() => {
    const ids: string[] = [];
    for (const cat of categories) {
      if (cat.kind === 'expense') {
        ids.push(cat.id);
        for (const child of cat.children ?? []) ids.push(child.id);
      }
    }
    return ids;
  }, [categories]);

  const isAllExpenses = useMemo(() => {
    if (expenseIds.length === 0 || values.length !== expenseIds.length) return false;
    const vSet = new Set(values);
    return expenseIds.every((id) => vSet.has(id));
  }, [values, expenseIds]);

  const label = useMemo(() => {
    if (values.length === 0) return 'All categories';
    if (isAllExpenses) return 'All expenses';
    if (values.length === 1) {
      for (const cat of categories) {
        if (cat.id === values[0]) return cat.name;
        for (const child of cat.children ?? []) {
          if (child.id === values[0]) return child.name;
        }
      }
    }
    return `${values.length} categories`;
  }, [values, categories, isAllExpenses]);

  useEffect(() => {
    function onMouseDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const valSet = useMemo(() => new Set(values), [values]);

  function toggleExpand(id: string, e: React.MouseEvent) {
    e.stopPropagation();
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) { next.delete(id); } else { next.add(id); }
      return next;
    });
  }

  // Clicking a parent selects/deselects parent + all its children together.
  function toggleParent(cat: PickerCategory, e: React.MouseEvent) {
    e.stopPropagation();
    const childIds = (cat.children ?? []).map((c) => c.id);
    const familyIds = [cat.id, ...childIds];
    const allSelected = familyIds.every((id) => valSet.has(id));
    const next = new Set(valSet);
    if (allSelected) {
      familyIds.forEach((id) => next.delete(id));
    } else {
      familyIds.forEach((id) => next.add(id));
    }
    onChange([...next]);
  }

  function toggleChild(id: string, e: React.MouseEvent) {
    e.stopPropagation();
    const next = new Set(valSet);
    if (next.has(id)) { next.delete(id); } else { next.add(id); }
    onChange([...next]);
  }

  // Returns 'all' | 'some' | 'none' for a parent category.
  function parentState(cat: PickerCategory): 'all' | 'some' | 'none' {
    const childIds = (cat.children ?? []).map((c) => c.id);
    const familyIds = [cat.id, ...childIds];
    const selectedCount = familyIds.filter((id) => valSet.has(id)).length;
    if (selectedCount === 0) return 'none';
    if (selectedCount === familyIds.length) return 'all';
    return 'some';
  }

  return (
    <div ref={ref} className={`relative ${className ?? ''}`}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="h-[34px] flex items-center justify-between rounded-lg border border-gray-200 px-3 text-xs bg-white hover:border-gray-400 focus:outline-none min-w-[140px]"
      >
        <span className={values.length > 0 ? 'text-gray-900 font-medium' : 'text-gray-500'}>
          {label}
        </span>
        <svg
          width="12" height="12" viewBox="0 0 13 13" fill="none"
          className="text-gray-400 flex-shrink-0 ml-2"
          style={{ transform: open ? 'rotate(180deg)' : undefined, transition: 'transform 120ms' }}
        >
          <path d="M2.5 4.5l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <div className="absolute z-30 mt-1 left-0 min-w-[220px] bg-white border border-gray-200 rounded-lg shadow-lg max-h-80 overflow-y-auto">
          {/* All categories */}
          <button
            type="button"
            onClick={() => onChange([])}
            className={`w-full text-left px-3 py-2 text-sm hover:bg-gray-50 flex items-center gap-2 ${
              values.length === 0 ? 'text-blue-700 font-medium' : 'text-gray-500'
            }`}
          >
            <span className={`w-3.5 h-3.5 rounded border flex-shrink-0 flex items-center justify-center ${values.length === 0 ? 'border-blue-600 bg-blue-600' : 'border-gray-300'}`}>
              {values.length === 0 && <svg width="8" height="8" viewBox="0 0 8 8" fill="none"><path d="M1 4l2 2 4-4" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>}
            </span>
            All categories
          </button>

          {/* All expenses shortcut */}
          {expenseIds.length > 0 && (
            <button
              type="button"
              onClick={() => onChange(isAllExpenses ? [] : expenseIds)}
              className={`w-full text-left px-3 py-2 text-sm hover:bg-gray-50 flex items-center gap-2 ${
                isAllExpenses ? 'text-blue-700 font-medium' : 'text-gray-700'
              }`}
            >
              <span className={`w-3.5 h-3.5 rounded border flex-shrink-0 flex items-center justify-center ${isAllExpenses ? 'border-blue-600 bg-blue-600' : 'border-gray-300'}`}>
                {isAllExpenses && <svg width="8" height="8" viewBox="0 0 8 8" fill="none"><path d="M1 4l2 2 4-4" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>}
              </span>
              All expenses
            </button>
          )}

          <div className="border-t border-gray-100 my-0.5" />

          {categories.map((cat) => {
            const hasChildren = (cat.children ?? []).length > 0;
            const isExpanded = expandedIds.has(cat.id);
            const pState = parentState(cat);
            return (
              <div key={cat.id}>
                <div className="flex items-stretch">
                  {hasChildren ? (
                    <button
                      type="button"
                      onClick={(e) => toggleExpand(cat.id, e)}
                      className="flex items-center justify-center w-7 text-gray-400 hover:text-gray-700 flex-shrink-0"
                    >
                      <svg width="11" height="11" viewBox="0 0 11 11" fill="none"
                        style={{ transform: isExpanded ? 'rotate(0deg)' : 'rotate(-90deg)', transition: 'transform 120ms' }}>
                        <path d="M1.5 3.5l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </button>
                  ) : (
                    <div className="w-7 flex-shrink-0" />
                  )}
                  <button
                    type="button"
                    onClick={(e) => toggleParent(cat, e)}
                    className={`flex-1 text-left py-2 pr-3 text-sm font-medium hover:bg-gray-50 flex items-center gap-2 ${
                      pState !== 'none' ? 'text-blue-700' : 'text-gray-800'
                    }`}
                  >
                    {/* Checkbox: filled = all, dash = partial, empty = none */}
                    <span className={`w-3.5 h-3.5 rounded border flex-shrink-0 flex items-center justify-center ${pState !== 'none' ? 'border-blue-600 bg-blue-600' : 'border-gray-300'}`}>
                      {pState === 'all' && <svg width="8" height="8" viewBox="0 0 8 8" fill="none"><path d="M1 4l2 2 4-4" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>}
                      {pState === 'some' && <svg width="8" height="8" viewBox="0 0 8 8" fill="none"><path d="M1.5 4h5" stroke="white" strokeWidth="1.5" strokeLinecap="round"/></svg>}
                    </span>
                    <span className="flex items-center gap-1.5">
                      {cat.color && <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: cat.color }} />}
                      {cat.name}
                    </span>
                  </button>
                </div>
                {isExpanded && (cat.children ?? []).map((child) => {
                  const childChecked = valSet.has(child.id);
                  return (
                    <button
                      key={child.id}
                      type="button"
                      onClick={(e) => toggleChild(child.id, e)}
                      className={`w-full text-left pl-7 pr-3 py-1.5 text-sm hover:bg-gray-50 flex items-center gap-2 ${
                        childChecked ? 'text-blue-700' : 'text-gray-500'
                      }`}
                    >
                      <span className={`w-3.5 h-3.5 rounded border flex-shrink-0 flex items-center justify-center ${childChecked ? 'border-blue-600 bg-blue-600' : 'border-gray-300'}`}>
                        {childChecked && <svg width="8" height="8" viewBox="0 0 8 8" fill="none"><path d="M1 4l2 2 4-4" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>}
                      </span>
                      ↳ {child.name}
                    </button>
                  );
                })}
              </div>
            );
          })}

          {/* Clear selection footer (only when something is selected) */}
          {values.length > 0 && (
            <>
              <div className="border-t border-gray-100 mt-0.5" />
              <button
                type="button"
                onClick={() => { onChange([]); setOpen(false); }}
                className="w-full text-left px-3 py-2 text-xs text-gray-400 hover:text-gray-700 hover:bg-gray-50"
              >
                Clear filter
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

export function CategoryPicker({
  categories,
  value,
  onChange,
  placeholder = 'Select category',
  allowUncategorized = true,
  className,
}: Props) {
  const [open, setOpen] = useState(false);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const ref = useRef<HTMLDivElement>(null);

  const selected = useMemo(() => {
    for (const cat of categories) {
      if (cat.id === value) return cat;
      for (const child of cat.children ?? []) {
        if (child.id === value) return child;
      }
    }
    return null;
  }, [categories, value]);

  useEffect(() => {
    function onMouseDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  function toggleExpand(id: string, e: React.MouseEvent) {
    e.stopPropagation();
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) { next.delete(id); } else { next.add(id); }
      return next;
    });
  }

  function pick(id: string | null) {
    onChange(id);
    setOpen(false);
  }

  return (
    <div ref={ref} className={`relative ${className ?? ''}`}>
      {/* Trigger */}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full h-[38px] flex items-center justify-between rounded-lg border border-gray-300 px-3 text-sm bg-white hover:border-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
      >
        <span className={selected ? 'text-gray-900' : 'text-gray-400'}>
          {selected ? selected.name : placeholder}
        </span>
        <svg
          width="13"
          height="13"
          viewBox="0 0 13 13"
          fill="none"
          className="text-gray-400 flex-shrink-0 ml-2"
          style={{ transform: open ? 'rotate(180deg)' : undefined, transition: 'transform 120ms' }}
        >
          <path d="M2.5 4.5l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {/* Dropdown panel */}
      {open && (
        <div className="absolute z-30 mt-1 w-full min-w-[220px] bg-white border border-gray-200 rounded-lg shadow-lg max-h-72 overflow-y-auto">
          {allowUncategorized && (
            <>
              <button
                type="button"
                onClick={() => pick(null)}
                className={`w-full text-left px-3 py-2 text-sm hover:bg-gray-50 ${
                  value === null ? 'bg-blue-50 text-blue-700 font-medium' : 'text-gray-500'
                }`}
              >
                Uncategorized
              </button>
              <div className="border-t border-gray-100 my-0.5" />
            </>
          )}

          {categories.map((cat) => {
            const hasChildren = (cat.children ?? []).length > 0;
            const isExpanded = expandedIds.has(cat.id);

            return (
              <div key={cat.id}>
                <div className="flex items-stretch">
                  {/* Expand chevron (only for parents with children) */}
                  {hasChildren ? (
                    <button
                      type="button"
                      onClick={(e) => toggleExpand(cat.id, e)}
                      className="flex items-center justify-center w-7 text-gray-400 hover:text-gray-700 flex-shrink-0"
                    >
                      <svg
                        width="11"
                        height="11"
                        viewBox="0 0 11 11"
                        fill="none"
                        style={{ transform: isExpanded ? 'rotate(0deg)' : 'rotate(-90deg)', transition: 'transform 120ms' }}
                      >
                        <path d="M1.5 3.5l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </button>
                  ) : (
                    <div className="w-7 flex-shrink-0" />
                  )}

                  {/* Category name */}
                  <button
                    type="button"
                    onClick={() => pick(cat.id)}
                    className={`flex-1 text-left py-2 pr-3 text-sm font-medium hover:bg-gray-50 ${
                      value === cat.id ? 'text-blue-700 bg-blue-50' : 'text-gray-800'
                    }`}
                  >
                    <span className="flex items-center gap-1.5">
                      {cat.color && (
                        <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: cat.color }} />
                      )}
                      {cat.name}
                    </span>
                  </button>
                </div>

                {/* Sub-categories (shown when expanded) */}
                {isExpanded && (cat.children ?? []).map((child) => (
                  <button
                    key={child.id}
                    type="button"
                    onClick={() => pick(child.id)}
                    className={`w-full text-left pl-9 pr-3 py-1.5 text-sm hover:bg-gray-50 ${
                      value === child.id ? 'text-blue-700 bg-blue-50 font-medium' : 'text-gray-500'
                    }`}
                  >
                    ↳ {child.name}
                  </button>
                ))}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
