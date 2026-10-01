const store = new Map<string, string>();

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async (k: string) => store.get(k) ?? null),
  setItemAsync: jest.fn(async (k: string, v: string) => {
    store.set(k, v);
  }),
  deleteItemAsync: jest.fn(async (k: string) => {
    store.delete(k);
  }),
}));

import {
  RATES_TTL_MS,
  RATES_URL,
  clearLiveRates,
  refreshLiveRates,
  sanitizeRates,
} from '../lib/exchangeRates';
import { convertFromUsd, convertToUsd, hasLiveRates } from '../lib/currency';

const mockFetch = jest.fn();
const okResponse = (rates: unknown, result = 'success') => ({
  ok: true,
  json: async () => ({ result, rates }),
});

beforeEach(() => {
  store.clear();
  mockFetch.mockReset();
  (global as unknown as { fetch: unknown }).fetch = mockFetch;
  clearLiveRates();
});

describe('sanitizeRates', () => {
  it('keeps known, positive, plausible rates and drops the rest', () => {
    const out = sanitizeRates({
      EUR: 0.9,
      JPY: 148,
      XYZ: 5, // unknown currency
      GBP: -1, // negative
      CAD: 'x', // not a number
      AUD: 99, // wildly off the fixed table
      INR: 83.1,
      USD: 7, // USD is the base, never overridden
    });
    expect(out).toEqual({ EUR: 0.9, JPY: 148, INR: 83.1 });
  });

  it('returns null for junk or when nothing is usable', () => {
    expect(sanitizeRates(null)).toBeNull();
    expect(sanitizeRates('rates')).toBeNull();
    expect(sanitizeRates({})).toBeNull();
    expect(sanitizeRates({ EUR: 0 })).toBeNull();
  });
});

describe('refreshLiveRates', () => {
  const now = 1_800_000_000_000;

  it('fetches, applies, and caches live rates', async () => {
    mockFetch.mockResolvedValue(okResponse({ EUR: 0.9, CAD: 1.4 }));
    await expect(refreshLiveRates(now)).resolves.toBe(true);
    expect(mockFetch).toHaveBeenCalledWith(RATES_URL, expect.anything());
    expect(hasLiveRates()).toBe(true);
    expect(convertFromUsd(10, 'EUR')).toBeCloseTo(9, 6);
    expect(convertToUsd(14, 'CAD')).toBeCloseTo(10, 6);
    // currencies the feed omitted keep the fixed rate
    expect(convertFromUsd(1, 'GBP')).toBeCloseTo(0.79, 6);
    expect(JSON.parse(store.get('bs.fx.liveRates')!).rates).toEqual({ EUR: 0.9, CAD: 1.4 });
  });

  it('uses a fresh cache without hitting the network', async () => {
    store.set('bs.fx.liveRates', JSON.stringify({ fetchedAt: now - 1000, rates: { EUR: 0.95 } }));
    await expect(refreshLiveRates(now)).resolves.toBe(true);
    expect(mockFetch).not.toHaveBeenCalled();
    expect(convertFromUsd(10, 'EUR')).toBeCloseTo(9.5, 6);
  });

  it('refreshes a stale cache', async () => {
    store.set('bs.fx.liveRates', JSON.stringify({ fetchedAt: now - RATES_TTL_MS - 1, rates: { EUR: 0.95 } }));
    mockFetch.mockResolvedValue(okResponse({ EUR: 0.9 }));
    await refreshLiveRates(now);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(convertFromUsd(10, 'EUR')).toBeCloseTo(9, 6);
  });

  it('keeps the stale cache when the refresh fails', async () => {
    store.set('bs.fx.liveRates', JSON.stringify({ fetchedAt: now - RATES_TTL_MS - 1, rates: { EUR: 0.95 } }));
    mockFetch.mockRejectedValue(new Error('offline'));
    await expect(refreshLiveRates(now)).resolves.toBe(true);
    expect(convertFromUsd(10, 'EUR')).toBeCloseTo(9.5, 6);
  });

  it('falls back to fixed rates when there is no cache and the fetch fails or is unusable', async () => {
    mockFetch.mockResolvedValue({ ok: false, json: async () => ({}) });
    await expect(refreshLiveRates(now)).resolves.toBe(false);
    mockFetch.mockResolvedValue(okResponse({ EUR: 0.9 }, 'error'));
    await expect(refreshLiveRates(now)).resolves.toBe(false);
    mockFetch.mockResolvedValue(okResponse({ EUR: 500 }));
    await expect(refreshLiveRates(now)).resolves.toBe(false);
    expect(hasLiveRates()).toBe(false);
    expect(convertFromUsd(10, 'EUR')).toBeCloseTo(9.2, 6);
  });

  it('ignores a corrupt cache', async () => {
    store.set('bs.fx.liveRates', '{nope');
    mockFetch.mockResolvedValue(okResponse({ EUR: 0.9 }));
    await expect(refreshLiveRates(now)).resolves.toBe(true);
    expect(convertFromUsd(10, 'EUR')).toBeCloseTo(9, 6);
  });
});

describe('clearLiveRates', () => {
  it('reverts to the fixed table', async () => {
    mockFetch.mockResolvedValue(okResponse({ EUR: 0.9 }));
    await refreshLiveRates();
    clearLiveRates();
    expect(hasLiveRates()).toBe(false);
    expect(convertFromUsd(10, 'EUR')).toBeCloseTo(9.2, 6);
  });
});
