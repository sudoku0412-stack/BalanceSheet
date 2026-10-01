import {
  CURRENCIES,
  CURRENCY_SYMBOLS,
  FREE_CURRENCIES,
  PREMIUM_CURRENCIES,
  convertFromUsd,
  convertToUsd,
  currencyDecimals,
  formatCurrency,
  isPremiumCurrency,
} from '../lib/currency';

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

describe('premium currencies', () => {
  it('keeps the original five free and gates the rest', () => {
    expect(FREE_CURRENCIES).toEqual(['USD', 'EUR', 'GBP', 'INR', 'CAD']);
    for (const c of FREE_CURRENCIES) expect(isPremiumCurrency(c)).toBe(false);
    for (const c of PREMIUM_CURRENCIES) expect(isPremiumCurrency(c)).toBe(true);
  });

  it('CURRENCIES is free + premium with no duplicates and full symbol/rate coverage', () => {
    expect(CURRENCIES).toHaveLength(FREE_CURRENCIES.length + PREMIUM_CURRENCIES.length);
    expect(new Set(CURRENCIES).size).toBe(CURRENCIES.length);
    for (const c of CURRENCIES) {
      expect(CURRENCY_SYMBOLS[c]).toBeTruthy();
      expect(convertFromUsd(1, c)).toBeGreaterThan(0);
    }
  });

  it('round-trips every currency', () => {
    for (const c of CURRENCIES) {
      expect(convertToUsd(convertFromUsd(42.5, c), c)).toBeCloseTo(42.5, 6);
    }
  });

  it('uses 0 decimals for INR, JPY, KRW and 2 elsewhere', () => {
    for (const c of ['INR', 'JPY', 'KRW'] as const) expect(currencyDecimals(c)).toBe(0);
    for (const c of ['USD', 'AUD', 'CHF', 'AED'] as const) expect(currencyDecimals(c)).toBe(2);
    expect(formatCurrency(10, 'JPY')).toBe('¥1500');
    expect(formatCurrency(10, 'AUD')).toBe('A$15.20');
    expect(formatCurrency(10, 'CHF')).toBe('CHF 8.80');
    expect(formatCurrency(10, 'SEK')).toBe('kr 105.00');
  });
});
