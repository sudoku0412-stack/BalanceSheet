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
 * Fixed demo exchange rates (USD is canonical, matching the design spec's
 * "store canonical value in USD internally" rule). Prototype-level, per
 * the design handoff README — approximate, NOT live; swap for a live FX
 * rate API in production.
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

export function convertFromUsd(amountUsd: number, to: CurrencyCode): number {
  return amountUsd * RATES_FROM_USD[to];
}

export function convertToUsd(amount: number, from: CurrencyCode): number {
  return amount / RATES_FROM_USD[from];
}

export function formatCurrency(amountUsd: number, currency: CurrencyCode): string {
  const converted = convertFromUsd(amountUsd, currency);
  const decimals = currencyDecimals(currency);
  return `${currencyPrefix(currency)}${converted.toFixed(decimals)}`;
}
