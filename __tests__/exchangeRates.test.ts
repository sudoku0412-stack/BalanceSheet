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
import {
  convertEntryToUsd,
  convertFromUsd,
  convertToUsd,
  convertUsdToEntry,
  entryFxRate,
  hasLiveRates,
} from '../lib/currency';

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
    // stored-amount conversion NEVER uses live rates (no drift)
    expect(convertFromUsd(10, 'EUR')).toBeCloseTo(9.2, 6);
    expect(convertToUsd(13.8, 'CAD')).toBeCloseTo(10, 6);
    expect(JSON.parse(store.get('bs.fx.liveRates')!).rates).toEqual({ EUR: 0.9, CAD: 1.4 });
  });

  it('uses a fresh cache without hitting the network', async () => {
    store.set('bs.fx.liveRates', JSON.stringify({ fetchedAt: now - 1000, rates: { EUR: 0.95 } }));
    await expect(refreshLiveRates(now)).resolves.toBe(true);
    expect(mockFetch).not.toHaveBeenCalled();
    expect(hasLiveRates()).toBe(true);
    expect(entryFxRate('EUR', 'USD')).toBeCloseTo(0.95, 6);
  });

  it('refreshes a stale cache', async () => {
    store.set('bs.fx.liveRates', JSON.stringify({ fetchedAt: now - RATES_TTL_MS - 1, rates: { EUR: 0.95 } }));
    mockFetch.mockResolvedValue(okResponse({ EUR: 0.9 }));
    await refreshLiveRates(now);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(entryFxRate('EUR', 'USD')).toBeCloseTo(0.9, 6);
  });

  it('keeps the stale cache when the refresh fails', async () => {
    store.set('bs.fx.liveRates', JSON.stringify({ fetchedAt: now - RATES_TTL_MS - 1, rates: { EUR: 0.95 } }));
    mockFetch.mockRejectedValue(new Error('offline'));
    await expect(refreshLiveRates(now)).resolves.toBe(true);
    expect(entryFxRate('EUR', 'USD')).toBeCloseTo(0.95, 6);
  });

  it('falls back to fixed rates when there is no cache and the fetch fails or is unusable', async () => {
    mockFetch.mockResolvedValue({ ok: false, json: async () => ({}) });
    await expect(refreshLiveRates(now)).resolves.toBe(false);
    mockFetch.mockResolvedValue(okResponse({ EUR: 0.9 }, 'error'));
    await expect(refreshLiveRates(now)).resolves.toBe(false);
    mockFetch.mockResolvedValue(okResponse({ EUR: 500 }));
    await expect(refreshLiveRates(now)).resolves.toBe(false);
    expect(hasLiveRates()).toBe(false);
    expect(entryFxRate('EUR', 'USD')).toBeUndefined();
  });

  it('ignores a corrupt cache', async () => {
    store.set('bs.fx.liveRates', '{nope');
    mockFetch.mockResolvedValue(okResponse({ EUR: 0.9 }));
    await expect(refreshLiveRates(now)).resolves.toBe(true);
    expect(entryFxRate('EUR', 'USD')).toBeCloseTo(0.9, 6);
  });
});

describe('clearLiveRates', () => {
  it('reverts to the fixed table', async () => {
    mockFetch.mockResolvedValue(okResponse({ EUR: 0.9 }));
    await refreshLiveRates();
    clearLiveRates();
    expect(hasLiveRates()).toBe(false);
    expect(entryFxRate('EUR', 'USD')).toBeUndefined();
  });
});

describe('entry-time live cross rates (no drift)', () => {
  beforeEach(() => {
    mockFetch.mockResolvedValue(okResponse({ EUR: 0.9, CAD: 1.4 }));
  });

  it('is undefined for the profile currency, before rates load, or for an unknown pair', async () => {
    expect(entryFxRate('EUR', 'CAD')).toBeUndefined(); // nothing loaded yet
    await refreshLiveRates();
    expect(entryFxRate('CAD', 'CAD')).toBeUndefined();
    expect(entryFxRate('JPY', 'CAD')).toBeUndefined(); // feed had no JPY
  });

  it('a EUR receipt in a CAD profile displays as the live cross value, frozen', async () => {
    await refreshLiveRates();
    const fx = entryFxRate('EUR', 'CAD');
    expect(fx).toBeDefined();
    const usd = convertEntryToUsd(100, 'EUR', fx);
    // shown in CAD through the FIXED table = 100 EUR * live CAD / live EUR
    expect(convertFromUsd(usd, 'CAD')).toBeCloseTo((100 * 1.4) / 0.9, 6);
    // re-opening in EUR returns exactly what was typed
    expect(convertUsdToEntry(usd, 'EUR', fx)).toBeCloseTo(100, 6);
  });

  it('a USD receipt in a CAD profile uses USD live = 1', async () => {
    await refreshLiveRates();
    const fx = entryFxRate('USD', 'CAD');
    const usd = convertEntryToUsd(100, 'USD', fx);
    expect(convertFromUsd(usd, 'CAD')).toBeCloseTo(140, 6);
    expect(convertUsdToEntry(usd, 'USD', fx)).toBeCloseTo(100, 6);
  });

  it('later rate moves cannot change an already-stored amount', async () => {
    await refreshLiveRates();
    const fx = entryFxRate('EUR', 'CAD');
    const usd = convertEntryToUsd(100, 'EUR', fx);
    const shownBefore = convertFromUsd(usd, 'CAD');
    mockFetch.mockResolvedValue(okResponse({ EUR: 0.8, CAD: 1.5 }));
    await refreshLiveRates(Date.now() + 2 * RATES_TTL_MS);
    expect(convertFromUsd(usd, 'CAD')).toBe(shownBefore);
    expect(convertUsdToEntry(usd, 'EUR', fx)).toBeCloseTo(100, 6);
  });

  it('without a frozen fx, conversion uses the fixed table (non-Premium / same currency)', () => {
    expect(convertEntryToUsd(92, 'EUR')).toBeCloseTo(100, 6);
    expect(convertUsdToEntry(100, 'EUR')).toBeCloseTo(92, 6);
  });
});
