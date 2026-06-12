import { useState, useEffect, useRef, useMemo } from 'react';

export type PickerCategory = {
  id: string;
  name: string;
  color?: string | null;
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
      next.has(id) ? next.delete(id) : next.add(id);
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
