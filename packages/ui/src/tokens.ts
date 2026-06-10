// Design tokens — single source of truth for the visual language.
// Consumed by Tailwind config and directly in component styles.

export const colors = {
  // Brand
  primary: {
    50:  '#eff6ff',
    100: '#dbeafe',
    200: '#bfdbfe',
    300: '#93c5fd',
    400: '#60a5fa',
    500: '#3b82f6',
    600: '#2563eb',
    700: '#1d4ed8',
    800: '#1e40af',
    900: '#1e3a8a',
  },
  // Neutrals
  gray: {
    50:  '#f9fafb',
    100: '#f3f4f6',
    200: '#e5e7eb',
    300: '#d1d5db',
    400: '#9ca3af',
    500: '#6b7280',
    600: '#4b5563',
    700: '#374151',
    800: '#1f2937',
    900: '#111827',
  },
  // Semantic
  success: '#16a34a',
  warning: '#d97706',
  danger:  '#dc2626',
  info:    '#0284c7',
} as const;

export const chart = {
  // Ordered palette for multi-series charts
  palette: [
    '#3b82f6', // blue
    '#10b981', // emerald
    '#f59e0b', // amber
    '#ef4444', // red
    '#8b5cf6', // violet
    '#06b6d4', // cyan
    '#f97316', // orange
    '#84cc16', // lime
  ],
  grid:   '#e5e7eb',
  tooltip: {
    bg:     '#1f2937',
    text:   '#f9fafb',
    border: '#374151',
  },
} as const;
