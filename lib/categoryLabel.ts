import { tr, type TranslationKey } from './i18n';

const KEYS: Record<string, TranslationKey> = {
  Groceries: 'category_Groceries',
  Electronics: 'category_Electronics',
  Dining: 'category_Dining',
  Pharmacy: 'category_Pharmacy',
  Gas: 'category_Gas',
  Clothing: 'category_Clothing',
  Entertainment: 'category_Entertainment',
  Travel: 'category_Travel',
  Healthcare: 'category_Healthcare',
  Electricity: 'category_Electricity',
  Investments: 'category_Investments',
  Recurring: 'recurring',
  Other: 'category_Other',
  Salary: 'income_Salary',
  Freelance: 'income_Freelance',
  Gift: 'income_Gift',
  Interest: 'income_Interest',
  Refund: 'income_Refund',
  InvestmentReturn: 'income_InvestmentReturn',
};

/**
 * Display name for a category in the active language. Built-in expense
 * and income categories are stored (and synced) under their English
 * names, so only the label is translated; custom categories and AI tags
 * are user text and pass through unchanged.
 *
 * Reads the active language at call time, so call it during render (a
 * component that renders it should also use useT()/useLanguage() so it
 * re-renders when the language changes).
 */
export function categoryLabel(name: string): string {
  const key = KEYS[name];
  return key ? tr(key) : name;
}
