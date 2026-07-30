export type CurrencyCode = 'USD' | 'EUR' | 'GBP' | 'INR';

export const CURRENCIES: CurrencyCode[] = ['USD', 'EUR', 'GBP', 'INR'];

export const CURRENCY_SYMBOLS: Record<CurrencyCode, string> = {
  USD: '$',
  EUR: '€',
  GBP: '£',
  INR: '₹',
};

/**
 * Fixed demo exchange rates (USD is canonical, matching the design spec's
 * "store canonical value in USD internally" rule). Prototype-level, per
 * the design handoff README — swap for a live FX rate API in production.
 */
const RATES_FROM_USD: Record<CurrencyCode, number> = {
  USD: 1,
  EUR: 0.92,
  GBP: 0.79,
  INR: 83.3,
};

export function convertFromUsd(amountUsd: number, to: CurrencyCode): number {
  return amountUsd * RATES_FROM_USD[to];
}

export function convertToUsd(amount: number, from: CurrencyCode): number {
  return amount / RATES_FROM_USD[from];
}

export function formatCurrency(amountUsd: number, currency: CurrencyCode): string {
  const converted = convertFromUsd(amountUsd, currency);
  const decimals = currency === 'INR' ? 0 : 2;
  return `${CURRENCY_SYMBOLS[currency]}${converted.toFixed(decimals)}`;
}
