import { IncomeCategory } from '../types';

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
  switch (category) {
    case 'Salary':
      return 'Employer name';
    case 'Freelance':
      return 'Client / platform';
    case 'Gift':
      return 'Who gave it';
    case 'Interest':
      return 'Bank / account';
    case 'Refund':
      return 'Store or merchant';
    case 'InvestmentReturn':
      return 'Brokerage / fund';
    case 'Other':
    default:
      return 'Describe the source';
  }
}

export function incomeCategoryLabel(category: IncomeCategory): string {
  if (category === 'InvestmentReturn') return 'Investment return';
  return category;
}
