import { describe, it, expect } from 'vitest';
import { amortizedMonthlyMinor, cadenceMonths, computeReserveProgress } from './amortization';

describe('cadenceMonths / amortizedMonthlyMinor', () => {
  it('maps cadences to month counts', () => {
    expect(cadenceMonths('annual')).toBe(12);
    expect(cadenceMonths('semi')).toBe(6);
    expect(cadenceMonths('quarterly')).toBe(3);
  });

  it('divides the total evenly across the cadence', () => {
    expect(amortizedMonthlyMinor(120_00, 'annual')).toBe(1_000);
    expect(amortizedMonthlyMinor(60_00, 'semi')).toBe(1_000);
    expect(amortizedMonthlyMinor(30_00, 'quarterly')).toBe(1_000);
  });

  it('rounds to the nearest cent', () => {
    expect(amortizedMonthlyMinor(100, 'annual')).toBe(8); // 100/12 = 8.33
  });

  it('actual-method funds have no monthly set-aside', () => {
    expect(amortizedMonthlyMinor(120_00, 'annual', 'actual')).toBe(0);
  });
});

describe('computeReserveProgress', () => {
  const base = {
    totalMinor: 120_00, // $1,200/yr -> $100/mo
    cadence: 'annual' as const,
    nextDueDate: '2026-12-01',
    startMode: 'gradual' as const,
    createdAt: '2026-01-01',
    reserveBalanceMinor: 0,
  };

  it('accrues gradually month by month from accrual start (max of cycle start and fund creation)', () => {
    // cycleStart = 2025-12-01, but fund created 2026-01-01 -> accrual starts 2026-01-01;
    // 2 months elapsed by 2026-03-01
    const p = computeReserveProgress({ ...base, asOf: '2026-03-01' });
    expect(p.cycleStart).toBe('2025-12-01');
    expect(p.monthlyAmountMinor).toBe(amortizedMonthlyMinor(base.totalMinor, base.cadence));
    expect(p.monthsElapsed).toBe(2);
    expect(p.targetByNowMinor).toBe(p.monthlyAmountMinor * 2);
  });

  it('reports on-track when balance matches target', () => {
    const monthly = amortizedMonthlyMinor(base.totalMinor, base.cadence);
    const p = computeReserveProgress({
      ...base,
      asOf: '2026-03-01',
      reserveBalanceMinor: monthly * 2,
    });
    expect(p.status).toBe('on-track');
    expect(p.deltaMinor).toBe(0);
  });

  it('reports behind when balance is short of target', () => {
    const monthly = amortizedMonthlyMinor(base.totalMinor, base.cadence);
    const p = computeReserveProgress({
      ...base,
      asOf: '2026-03-01',
      reserveBalanceMinor: monthly, // only 1 month saved, but 2 expected
    });
    expect(p.status).toBe('behind');
    expect(p.deltaMinor).toBeLessThan(0);
  });

  it('reports ahead when balance exceeds target', () => {
    const monthly = amortizedMonthlyMinor(base.totalMinor, base.cadence);
    const p = computeReserveProgress({
      ...base,
      asOf: '2026-03-01',
      reserveBalanceMinor: monthly * 6,
    });
    expect(p.status).toBe('ahead');
    expect(p.deltaMinor).toBeGreaterThan(0);
  });

  it('clamps months elapsed to the cadence length', () => {
    // Fund is years old — elapsed should clamp to periodMonths (12), not run away.
    const p = computeReserveProgress({
      ...base,
      createdAt: '2020-01-01',
      asOf: '2030-01-01',
    });
    expect(p.monthsElapsed).toBe(12);
    expect(p.targetByNowMinor).toBe(p.monthlyAmountMinor * 12);
  });

  it('gradual start: accrual begins no earlier than fund creation, even mid-cycle', () => {
    // cycleStart = 2025-12-01, but fund created 2026-02-01 (mid-cycle)
    const p = computeReserveProgress({
      ...base,
      createdAt: '2026-02-01',
      asOf: '2026-04-01',
    });
    // accrualStart = max(2025-12-01, 2026-02-01) = 2026-02-01 -> 2 months elapsed by 2026-04-01
    expect(p.monthsElapsed).toBe(2);
  });

  it('frontload start: accrual is measured from cycle start regardless of fund creation', () => {
    const p = computeReserveProgress({
      ...base,
      startMode: 'frontload',
      createdAt: '2026-02-01',
      asOf: '2026-04-01',
    });
    // cycleStart = 2025-12-01 -> 4 months elapsed by 2026-04-01
    expect(p.monthsElapsed).toBe(4);
  });

  it('actual-method funds never accrue and report on-track with zero target', () => {
    const p = computeReserveProgress({
      ...base,
      method: 'actual',
      asOf: '2026-06-01',
      reserveBalanceMinor: 500_00,
    });
    expect(p.monthlyAmountMinor).toBe(0);
    expect(p.targetByNowMinor).toBe(0);
    expect(p.reserveBalanceMinor).toBe(0);
    expect(p.status).toBe('on-track');
    expect(p.shortfallMinor).toBe(0);
  });

  it('flags a shortfall when projected reserve is below the total', () => {
    const monthly = amortizedMonthlyMinor(base.totalMinor, base.cadence);
    const p = computeReserveProgress({
      ...base,
      asOf: '2026-03-01', // 3 months elapsed -> target = 3*monthly
      reserveBalanceMinor: monthly * 3,
    });
    expect(p.shortfallMinor).toBe(base.totalMinor - monthly * 3);
  });

  it('reports no shortfall once the reserve covers the total', () => {
    const p = computeReserveProgress({
      ...base,
      asOf: '2026-12-01',
      reserveBalanceMinor: base.totalMinor,
    });
    expect(p.shortfallMinor).toBe(0);
  });
});
