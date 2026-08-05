import { normalizePhoneE164 } from '../lib/phone';

describe('normalizePhoneE164', () => {
  it('normalizes a valid US number already in E.164', () => {
    expect(normalizePhoneE164('+14165551234')).toBe('+14165551234');
  });

  it('normalizes a valid US number with defaultRegion when no country code given', () => {
    expect(normalizePhoneE164('4165551234', 'US')).toBe('+14165551234');
  });

  it('normalizes a formatted US number with defaultRegion', () => {
    expect(normalizePhoneE164('(416) 555-1234', 'US')).toBe('+14165551234');
  });

  it('returns null for an invalid number', () => {
    expect(normalizePhoneE164('123')).toBeNull();
  });

  it('returns null for an empty string', () => {
    expect(normalizePhoneE164('')).toBeNull();
  });

  it('returns null when no defaultRegion and number has no country code', () => {
    expect(normalizePhoneE164('4165551234')).toBeNull();
  });
});
