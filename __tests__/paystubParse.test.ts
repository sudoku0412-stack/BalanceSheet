import { parsePaystubText } from '../lib/paystubParse';

describe('parsePaystubText', () => {
  it('reads net pay, pay date, and employer', () => {
    const text = [
      'Acme Corp',
      '123 Main Street',
      'Earnings statement',
      'Pay date: 03/15/2026',
      'Gross pay $4,000.00',
      'Net pay $3,210.55',
    ].join('\n');
    const parsed = parsePaystubText(text);
    expect(parsed.amount).toBeCloseTo(3210.55);
    expect(parsed.date).toBe('2026-03-15');
    expect(parsed.sourceName).toBe('Acme Corp');
    expect(parsed.category).toBe('Salary');
    expect(parsed.confidence).toBe('high');
    expect(parsed.notes).toMatch(/Gross 4000.00/);
  });

  it('falls back to gross when net is missing', () => {
    const parsed = parsePaystubText('Employer: Northwind\nGross earnings 1800.00\nPeriod ending 2026-01-31');
    expect(parsed.amount).toBeCloseTo(1800);
    expect(parsed.date).toBe('2026-01-31');
    expect(parsed.sourceName).toBe('Northwind');
    expect(parsed.confidence).toBe('low');
  });

  it('returns low confidence when almost nothing is readable', () => {
    const parsed = parsePaystubText('blurry photo');
    expect(parsed.amount).toBeNull();
    expect(parsed.confidence).toBe('low');
  });
});
