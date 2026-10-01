export type FreeCurrencyCode = 'USD' | 'EUR' | 'GBP' | 'INR' | 'CAD';
export type PremiumCurrencyCode =
  | 'AUD'
  | 'NZD'
  | 'SGD'
  | 'JPY'
  | 'KRW'
  | 'CNY'
  | 'CHF'
  | 'SEK'
  | 'MXN'
  | 'BRL'
  | 'ZAR'
  | 'AED';
export type CurrencyCode = FreeCurrencyCode | PremiumCurrencyCode;

/** Available to everyone. */
export const FREE_CURRENCIES: FreeCurrencyCode[] = ['USD', 'EUR', 'GBP', 'INR', 'CAD'];

/** Premium-only: selecting one while not subscribed opens the paywall.
 *  A premium user who lapses keeps seeing amounts in their saved
 *  currency — only picking a NEW premium currency is locked. */
export const PREMIUM_CURRENCIES: PremiumCurrencyCode[] = [
  'AUD',
  'NZD',
  'SGD',
  'JPY',
  'KRW',
  'CNY',
  'CHF',
  'SEK',
  'MXN',
  'BRL',
  'ZAR',
  'AED',
];

export const CURRENCIES: CurrencyCode[] = [...FREE_CURRENCIES, ...PREMIUM_CURRENCIES];

export function isPremiumCurrency(code: CurrencyCode): boolean {
  return (PREMIUM_CURRENCIES as string[]).includes(code);
}

/** Currencies with no everyday minor unit render without decimals. */
const ZERO_DECIMAL: CurrencyCode[] = ['INR', 'JPY', 'KRW'];

export function currencyDecimals(code: CurrencyCode): number {
  return ZERO_DECIMAL.includes(code) ? 0 : 2;
}

export const CURRENCY_SYMBOLS: Record<CurrencyCode, string> = {
  USD: '$',
  EUR: '€',
  GBP: '£',
  INR: '₹',
  CAD: 'CA$',
  AUD: 'A$',
  NZD: 'NZ$',
  SGD: 'S$',
  JPY: '¥',
  KRW: '₩',
  CNY: 'CN¥',
  CHF: 'CHF',
  SEK: 'kr',
  MXN: 'MX$',
  BRL: 'R$',
  ZAR: 'R',
  AED: 'AED',
};

/** Symbol as it prefixes an amount: alphabetic symbols (CHF, kr, AED, R)
 *  get a trailing space ("CHF 13.20"); punctuation ones (€, A$) do not. */
export function currencyPrefix(code: CurrencyCode): string {
  const sym = CURRENCY_SYMBOLS[code];
  return /[A-Za-z]$/.test(sym) ? `${sym} ` : sym;
}

/**
 * Fixed approximate exchange rates (USD is canonical, matching the design
 * spec's "store canonical value in USD internally" rule). Not live: Premium
 * users get refreshed rates layered on top via setLiveRates().
 */
const RATES_FROM_USD: Record<CurrencyCode, number> = {
  USD: 1,
  EUR: 0.92,
  GBP: 0.79,
  INR: 83.3,
  CAD: 1.38,
  AUD: 1.52,
  NZD: 1.65,
  SGD: 1.34,
  JPY: 150,
  KRW: 1350,
  CNY: 7.2,
  CHF: 0.88,
  SEK: 10.5,
  MXN: 17.2,
  BRL: 5.0,
  ZAR: 18.2,
  AED: 3.67,
};

/**
 * Premium live rates (lib/exchangeRates.ts), when loaded. They are NEVER
 * used to display stored amounts: every stored figure is USD-canonical and
 * shown through the fixed table, so a rate refresh cannot change anything
 * already saved. Live rates apply only at entry time, to convert a receipt
 * typed in a currency other than the profile currency (see entryFxRate).
 */
let liveRates: Partial<Record<CurrencyCode, number>> | null = null;

export function setLiveRates(rates: Partial<Record<CurrencyCode, number>> | null): void {
  liveRates = rates;
}

export function hasLiveRates(): boolean {
  return liveRates !== null;
}

/** The fixed approximate rates, for validating live data against. */
export function fixedRateFromUsd(code: CurrencyCode): number {
  return RATES_FROM_USD[code];
}

/** Live units-per-USD for a currency, or undefined when not loaded. */
function liveRateFor(code: CurrencyCode): number | undefined {
  if (code === 'USD') return 1;
  return liveRates?.[code];
}

export function convertFromUsd(amountUsd: number, to: CurrencyCode): number {
  return amountUsd * RATES_FROM_USD[to];
}

export function convertToUsd(amount: number, from: CurrencyCode): number {
  return amount / RATES_FROM_USD[from];
}

/**
 * Effective rate (units of `entry` currency per canonical USD) for a
 * receipt typed in `entry` while the profile currency is `profile`, using
 * today's live cross rate — or undefined when the fixed table applies
 * (same currency, live rates not loaded for both currencies, not Premium).
 *
 * Choosing fx = fixed(profile) * live(entry) / live(profile) makes the
 * stored USD value display, in the profile currency, as exactly
 * amount * live(profile) / live(entry): the live cross-converted figure,
 * frozen at entry. Re-opening the receipt multiplies back by the same fx,
 * so the typed amount round-trips unchanged.
 */
export function entryFxRate(entry: CurrencyCode, profile: CurrencyCode): number | undefined {
  if (entry === profile) return undefined;
  const liveEntry = liveRateFor(entry);
  const liveProfile = liveRateFor(profile);
  if (liveEntry === undefined || liveProfile === undefined) return undefined;
  return (RATES_FROM_USD[profile] * liveEntry) / liveProfile;
}

/** Entry-currency amount → canonical USD, honoring a frozen `fx` if any. */
export function convertEntryToUsd(amount: number, entry: CurrencyCode, fx?: number): number {
  return amount / (fx ?? RATES_FROM_USD[entry]);
}

/** Canonical USD → entry-currency amount, honoring a frozen `fx` if any. */
export function convertUsdToEntry(amountUsd: number, entry: CurrencyCode, fx?: number): number {
  return amountUsd * (fx ?? RATES_FROM_USD[entry]);
}

export function formatCurrency(amountUsd: number, currency: CurrencyCode): string {
  const converted = convertFromUsd(amountUsd, currency);
  const decimals = currencyDecimals(currency);
  return `${currencyPrefix(currency)}${converted.toFixed(decimals)}`;
}
