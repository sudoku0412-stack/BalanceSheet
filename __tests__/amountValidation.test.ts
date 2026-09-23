import { parseAmountInput, sanitizeAmountInput } from '../lib/amountValidation';

describe('sanitizeAmountInput', () => {
  it('strips letters and symbols, keeping digits/dot/comma', () => {
    expect(sanitizeAmountInput('$12.50 USD')).toBe('12.50');
    expect(sanitizeAmountInput('1,234.56 abc')).toBe('1,234.56');
  });

  it('leaves an already-clean string untouched', () => {
    expect(sanitizeAmountInput('12.50')).toBe('12.50');
  });

  it('returns empty string for input with no money characters', () => {
    expect(sanitizeAmountInput('abc')).toBe('');
  });
});

describe('parseAmountInput', () => {
  it('parses a plain integer', () => {
    expect(parseAmountInput('12')).toBe(12);
  });

  it('parses a simple decimal', () => {
    expect(parseAmountInput('12.5')).toBe(12.5);
    expect(parseAmountInput('12.50')).toBe(12.5);
  });

  it('treats the last "." as the decimal separator and strips "," thousands grouping', () => {
    expect(parseAmountInput('1,234.56')).toBe(1234.56);
    expect(parseAmountInput('12,345.67')).toBe(12345.67);
  });

  it('treats the last "," as the decimal separator and strips "." thousands grouping', () => {
    expect(parseAmountInput('1.234,56')).toBe(1234.56);
  });

  it('treats a lone "," with no other separator as the decimal point', () => {
    expect(parseAmountInput('12,50')).toBe(12.5);
  });

  it('rejects more than one instance of the decimal separator character', () => {
    // "12.50.99" — two dots, last one is treated as decimal, so the first
    // is also a "." and gets counted, making this malformed rather than grouped.
    expect(parseAmountInput('12.50.99')).toBeNull();
  });

  it('rejects more than 2 fractional digits', () => {
    expect(parseAmountInput('12.505')).toBeNull();
  });

  it('returns null for empty or whitespace-only input', () => {
    expect(parseAmountInput('')).toBeNull();
    expect(parseAmountInput('   ')).toBeNull();
  });

  it('returns null for input with no digits', () => {
    expect(parseAmountInput('.')).toBeNull();
    expect(parseAmountInput(',')).toBeNull();
  });

  it('trims surrounding whitespace before parsing', () => {
    expect(parseAmountInput('  12.50  ')).toBe(12.5);
  });

  it('parses a value with no decimal separator at all', () => {
    expect(parseAmountInput('500')).toBe(500);
  });

  it('accepts a trailing decimal point with no fractional digits', () => {
    expect(parseAmountInput('12.')).toBe(12);
  });
});
