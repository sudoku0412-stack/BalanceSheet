import { convertFromUsd, convertToUsd, formatCurrency } from '../lib/currency';

describe('convertFromUsd / convertToUsd', () => {
  it('USD is identity', () => {
    expect(convertFromUsd(100, 'USD')).toBe(100);
    expect(convertToUsd(100, 'USD')).toBe(100);
  });

  it('round-trips through a non-USD currency', () => {
    const usd = 123.45;
    for (const code of ['EUR', 'GBP', 'INR', 'CAD'] as const) {
      const converted = convertFromUsd(usd, code);
      const back = convertToUsd(converted, code);
      expect(back).toBeCloseTo(usd, 6);
    }
  });

  it('applies the fixed demo rates', () => {
    expect(convertFromUsd(1, 'EUR')).toBeCloseTo(0.92, 5);
    expect(convertFromUsd(1, 'GBP')).toBeCloseTo(0.79, 5);
    expect(convertFromUsd(1, 'INR')).toBeCloseTo(83.3, 5);
    expect(convertFromUsd(1, 'CAD')).toBeCloseTo(1.38, 5);
  });
});

describe('formatCurrency', () => {
  it('formats USD with symbol and 2 decimals', () => {
    expect(formatCurrency(10, 'USD')).toBe('$10.00');
  });

  it('formats EUR/GBP/CAD with 2 decimals and correct symbol', () => {
    expect(formatCurrency(10, 'EUR')).toBe(`€${(10 * 0.92).toFixed(2)}`);
    expect(formatCurrency(10, 'GBP')).toBe(`£${(10 * 0.79).toFixed(2)}`);
    expect(formatCurrency(10, 'CAD')).toBe(`CA$${(10 * 1.38).toFixed(2)}`);
  });

  it('formats INR with 0 decimals (no paise shown)', () => {
    expect(formatCurrency(10, 'INR')).toBe(`₹${Math.round(10 * 83.3)}`);
    expect(formatCurrency(10, 'INR')).not.toContain('.');
  });
});
