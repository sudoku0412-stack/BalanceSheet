import { IncomeCategory } from '../types';
import { categoryLabel } from '../lib/categoryLabel';
import { tr, type TranslationKey } from '../lib/i18n';

export const INCOME_CATEGORY_ICONS: Record<IncomeCategory, string> = {
  Salary: '💼',
  Freelance: '🖥️',
  Gift: '🎁',
  Interest: '🏦',
  Refund: '↩️',
  InvestmentReturn: '📈',
  Other: '✨',
};

export const ALL_INCOME_CATEGORIES: IncomeCategory[] = [
  'Salary',
  'Freelance',
  'Gift',
  'Interest',
  'Refund',
  'InvestmentReturn',
  'Other',
];

/** Placeholder for the free-text source name field, keyed by type. */
export function sourceNamePlaceholder(category: IncomeCategory): string {
  const key = `sourcePlaceholder_${category}` as TranslationKey;
  return tr(key);
}

export function incomeCategoryLabel(category: IncomeCategory): string {
  return categoryLabel(category);
}
