// E6.3 — Sinking fund amortization math.
// Virtual reserves only (Phase 1): a sinking fund's monthly set-aside is the total amount
// spread evenly across its cadence; reserve progress compares the accrued balance against
// what should have accrued by now given the cadence, due date, and start mode.

export type SinkingFundCadence = 'annual' | 'semi' | 'quarterly';
export type SinkingFundMethod = 'amortized' | 'actual';
export type SinkingFundStartMode = 'gradual' | 'frontload';
export type ReserveStatus = 'ahead' | 'on-track' | 'behind';

const CADENCE_MONTHS: Record<SinkingFundCadence, number> = {
  annual: 12,
  semi: 6,
  quarterly: 3,
};

export function cadenceMonths(cadence: SinkingFundCadence): number {
  return CADENCE_MONTHS[cadence];
}

/**
 * Monthly virtual-reserve set-aside for an amortized sinking fund.
 * `actual`-method funds have no set-aside — the full bill hits the month it's paid (B-3/B-5).
 */
export function amortizedMonthlyMinor(totalMinor: number, cadence: SinkingFundCadence, method: SinkingFundMethod = 'amortized'): number {
  if (method === 'actual') return 0;
  return Math.round(totalMinor / cadenceMonths(cadence));
}

// Whole months between two dates (b - a), truncated toward zero. Day-of-month is ignored.
// Uses UTC fields throughout so date-only strings ("YYYY-MM-DD", parsed as UTC midnight)
// don't shift to the previous/next month under non-UTC local timezones.
function monthsBetween(a: Date, b: Date): number {
  return (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + (b.getUTCMonth() - a.getUTCMonth());
}

function addMonths(d: Date, months: number): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months, 1));
}

export interface ReserveProgress {
  monthlyAmountMinor: number;
  periodMonths: number;
  cycleStart: string; // YYYY-MM-DD (first of month)
  monthsElapsed: number;
  targetByNowMinor: number;
  reserveBalanceMinor: number;
  deltaMinor: number; // reserveBalanceMinor - targetByNowMinor; negative = behind
  status: ReserveStatus;
  shortfallMinor: number; // max(0, totalMinor - max(reserveBalanceMinor, targetByNowMinor))
}

/**
 * Reserve progress for a sinking fund as of a given date.
 *
 * - `gradual` start: the target accrues from the later of (cycle start, fund creation) —
 *   a fund created mid-cycle isn't expected to have caught up yet.
 * - `frontload` start: the target accrues from the cycle start regardless of when the fund
 *   was created — a mid-cycle fund is expected to "catch up" immediately.
 *
 * `actual`-method funds never accrue a reserve (B-3/B-5): target and balance are always 0.
 */
export function computeReserveProgress(params: {
  totalMinor: number;
  cadence: SinkingFundCadence;
  method?: SinkingFundMethod;
  nextDueDate: string; // YYYY-MM-DD
  startMode: SinkingFundStartMode;
  createdAt: string; // YYYY-MM-DD
  reserveBalanceMinor: number;
  asOf?: string; // YYYY-MM-DD, default today
}): ReserveProgress {
  const method = params.method ?? 'amortized';
  const periodMonths = cadenceMonths(params.cadence);
  const monthlyAmountMinor = amortizedMonthlyMinor(params.totalMinor, params.cadence, method);

  const asOf = params.asOf ? new Date(params.asOf) : new Date();
  const nextDue = new Date(params.nextDueDate);
  const createdAt = new Date(params.createdAt);

  const cycleStart = addMonths(nextDue, -periodMonths);
  const accrualStart = params.startMode === 'frontload' ? cycleStart : new Date(Math.max(cycleStart.getTime(), createdAt.getTime()));

  const monthsElapsed = method === 'actual'
    ? 0
    : Math.min(Math.max(monthsBetween(accrualStart, asOf), 0), periodMonths);

  const targetByNowMinor = method === 'actual' ? 0 : monthlyAmountMinor * monthsElapsed;
  const reserveBalanceMinor = method === 'actual' ? 0 : params.reserveBalanceMinor;
  const deltaMinor = reserveBalanceMinor - targetByNowMinor;

  const status: ReserveStatus = deltaMinor > 0 ? 'ahead' : deltaMinor < 0 ? 'behind' : 'on-track';

  const projected = Math.max(reserveBalanceMinor, targetByNowMinor);
  const shortfallMinor = method === 'actual' ? 0 : Math.max(0, params.totalMinor - projected);

  return {
    monthlyAmountMinor,
    periodMonths,
    cycleStart: cycleStart.toISOString().slice(0, 10),
    monthsElapsed,
    targetByNowMinor,
    reserveBalanceMinor,
    deltaMinor,
    status,
    shortfallMinor,
  };
}
