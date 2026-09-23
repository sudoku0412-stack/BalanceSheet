import { calendarDateKey, isInCalendarMonth, isInCalendarRange } from '../lib/calendarDate';
import { filterReceiptsInRange } from '../lib/reports';
import { Receipt } from '../types';

const receipt = (date: string): Receipt => ({
  id: date,
  storeName: 'Store',
  date,
  totalAmount: 10,
  category: 'Other',
  createdAt: date,
  updatedAt: date,
});

describe('calendar dates', () => {
  it('keeps a YYYY-MM-DD string on that civil day in every timezone', () => {
    expect(calendarDateKey('2026-03-01')).toBe('2026-03-01');
    expect(isInCalendarMonth('2026-03-01', 2026, 3)).toBe(true);
    expect(isInCalendarMonth('2026-03-01', 2026, 2)).toBe(false);
  });

  it('puts a local-midnight ISO timestamp on that local calendar day', () => {
    const iso = new Date(2026, 2, 1, 0, 0, 0, 0).toISOString();
    expect(calendarDateKey(iso)).toBe('2026-03-01');
    expect(isInCalendarMonth(iso, 2026, 3)).toBe(true);
  });

  it('includes date-only day-1 receipts in the same month as date-only income', () => {
    const march = filterReceiptsInRange(
      [receipt('2026-03-01'), receipt('2026-02-28'), receipt('2026-04-01')],
      new Date(2026, 2, 1),
      new Date(2026, 2, 31),
    );
    expect(march.map((r) => r.date)).toEqual(['2026-03-01']);
    expect(isInCalendarRange('2026-03-01', new Date(2026, 2, 1), new Date(2026, 2, 31))).toBe(true);
  });
});
