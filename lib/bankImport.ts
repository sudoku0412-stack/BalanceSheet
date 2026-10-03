import { CURRENCIES, convertToUsd, type CurrencyCode } from './currency';
import type { Category, Receipt } from '../types';

/** A transaction as returned by the bank-sync Worker (Plaid's shape). */
export interface BankTransaction {
  transaction_id: string;
  amount: number;
  iso_currency_code?: string | null;
  date: string; // YYYY-MM-DD
  name: string;
  merchant_name?: string | null;
  pending?: boolean;
  personal_finance_category?: { primary?: string; detailed?: string } | null;
}

/** Plaid personal_finance_category → this app's categories. Anything not
 *  recognised becomes "Other"; the user confirms it in the Review inbox. */
export function mapBankCategory(primary?: string, detailed?: string): Category {
  const p = (primary ?? '').toUpperCase();
  const d = (detailed ?? '').toUpperCase();
  switch (p) {
    case 'FOOD_AND_DRINK':
      return d.includes('GROCERIES') ? 'Groceries' : 'Dining';
    case 'ENTERTAINMENT':
      return 'Entertainment';
    case 'MEDICAL':
      return d.includes('PHARMAC') ? 'Pharmacy' : 'Healthcare';
    case 'PERSONAL_CARE':
      return d.includes('PHARMAC') ? 'Pharmacy' : 'Other';
    case 'TRANSPORTATION':
      return d.includes('GAS') ? 'Gas' : 'Travel';
    case 'TRAVEL':
      return 'Travel';
    case 'RENT_AND_UTILITIES':
      return d.includes('ELECTRIC') || d.includes('GAS_AND_ELECTRICITY') ? 'Electricity' : 'Other';
    case 'GENERAL_MERCHANDISE':
      if (d.includes('CLOTHING')) return 'Clothing';
      if (d.includes('ELECTRONICS')) return 'Electronics';
      if (d.includes('SUPERSTORES') || d.includes('GROCER')) return 'Groceries';
      return 'Other';
    default:
      return 'Other';
  }
}

const SKIP_PRIMARY = new Set(['INCOME', 'TRANSFER_IN', 'TRANSFER_OUT', 'LOAN_PAYMENTS', 'BANK_FEES']);

/** Only settled money-out transactions become expenses. Pending ones are
 *  skipped (the posted version arrives later under a new id), as are
 *  deposits, refunds, transfers, loan payments and bank fees. */
export function shouldImportTransaction(t: BankTransaction): boolean {
  if (t.pending) return false;
  if (!(t.amount > 0)) return false;
  if (SKIP_PRIMARY.has((t.personal_finance_category?.primary ?? '').toUpperCase())) return false;
  return true;
}

/** Builds the receipt for a bank transaction (not yet saved). */
export function bankTransactionToReceipt(
  t: BankTransaction,
  profileCurrency: CurrencyCode,
  id: string,
  nowIso: string,
): Receipt {
  const currency = (CURRENCIES as string[]).includes(t.iso_currency_code ?? '')
    ? (t.iso_currency_code as CurrencyCode)
    : profileCurrency;
  const category = mapBankCategory(
    t.personal_finance_category?.primary,
    t.personal_finance_category?.detailed,
  );
  const [y, m, d] = t.date.split('-').map(Number);
  // Local-noon so the calendar date survives timezone conversions.
  const when = new Date(y, (m ?? 1) - 1, d ?? 1, 12, 0, 0);
  const storeName = (t.merchant_name?.trim() || t.name.trim() || 'Bank transaction').slice(0, 80);
  const rawName = t.name.trim();
  return {
    id,
    storeName,
    date: when.toISOString(),
    totalAmount: convertToUsd(t.amount, currency),
    category,
    categoryTags: [category],
    originalCurrency: currency,
    bankTxnId: t.transaction_id,
    // Keep the bank's own description when it adds something beyond the store name.
    notes: rawName && rawName !== storeName ? rawName : undefined,
    createdAt: nowIso,
    updatedAt: nowIso,
  };
}
