import * as SecureStore from 'expo-secure-store';
import {
  CURRENCIES,
  fixedRateFromUsd,
  setLiveRates,
  type CurrencyCode,
} from './currency';

/** Free, keyless USD-base rates (updated daily by the provider). */
export const RATES_URL = 'https://open.er-api.com/v6/latest/USD';

export const RATES_TTL_MS = 24 * 60 * 60 * 1000;
const CACHE_KEY = 'bs.fx.liveRates';
const FETCH_TIMEOUT_MS = 8000;

/** A live rate more than this far from the fixed table is treated as bad
 *  data (wrong base, outage payload) and ignored for that currency. */
const MAX_DEVIATION = 2;

type Cached = { fetchedAt: number; rates: Partial<Record<CurrencyCode, number>> };

/** Keeps only known currencies with sane positive numbers. Returns null
 *  when nothing usable is left. */
export function sanitizeRates(raw: unknown): Partial<Record<CurrencyCode, number>> | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const out: Partial<Record<CurrencyCode, number>> = {};
  for (const code of CURRENCIES) {
    if (code === 'USD') continue;
    const v = (raw as Record<string, unknown>)[code];
    if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) continue;
    const fixed = fixedRateFromUsd(code);
    if (v > fixed * MAX_DEVIATION || v < fixed / MAX_DEVIATION) continue;
    out[code] = v;
  }
  return Object.keys(out).length > 0 ? out : null;
}

async function readCache(): Promise<Cached | null> {
  try {
    const raw = await SecureStore.getItemAsync(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<Cached>;
    if (typeof parsed.fetchedAt !== 'number') return null;
    const rates = sanitizeRates(parsed.rates);
    return rates ? { fetchedAt: parsed.fetchedAt, rates } : null;
  } catch {
    return null;
  }
}

async function fetchRates(): Promise<Partial<Record<CurrencyCode, number>> | null> {
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS) : null;
  try {
    const resp = await fetch(RATES_URL, controller ? { signal: controller.signal } : undefined);
    if (!resp.ok) return null;
    const body = (await resp.json()) as { result?: string; rates?: unknown };
    if (body.result && body.result !== 'success') return null;
    return sanitizeRates(body.rates);
  } catch {
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Premium: apply cached live rates immediately, then refresh from the
 * network when the cache is older than a day. Any failure leaves whatever
 * was last applied (cache or fixed rates) in place. Returns true when live
 * rates are active afterwards.
 */
export async function refreshLiveRates(now: number = Date.now()): Promise<boolean> {
  const cached = await readCache();
  if (cached) setLiveRates(cached.rates);
  if (cached && now - cached.fetchedAt < RATES_TTL_MS) return true;

  const fresh = await fetchRates();
  if (!fresh) return cached !== null;
  setLiveRates(fresh);
  try {
    await SecureStore.setItemAsync(CACHE_KEY, JSON.stringify({ fetchedAt: now, rates: fresh }));
  } catch {
    // cache is best-effort
  }
  return true;
}

/** Back to the fixed approximate rates (e.g. Premium lapsed). */
export function clearLiveRates(): void {
  setLiveRates(null);
}
