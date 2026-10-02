import { RECURRING_BUDGET_KEY, isRecurringExpense } from './recurring';
import type { Receipt } from '../types';

/**
 * Spend per budget key for a set of (already month-scoped) receipts —
 * the one source for Home's budget progress and for budget alerts.
 *
 * Each receipt's full `totalAmount` (tax included) is what actually left
 * the wallet, so that is what gets attributed. When a receipt has line
 * items in several categories, the total is split across those categories
 * in proportion to their item amounts, so a Costco receipt with groceries
 * and clothing counts toward both budgets and the parts still sum to the
 * receipt total. A receipt without usable line items counts entirely
 * toward its own `category`.
 *
 * "Recurring" is a separate axis: every recurring expense also adds its
 * full total there, except a receipt whose category is literally
 * "Recurring" (already added once under that key).
 */
export function computeBudgetSpend(receipts: Receipt[]): Record<string, number> {
  const spend: Record<string, number> = {};
  const add = (key: string, amount: number) => {
    spend[key] = (spend[key] ?? 0) + amount;
  };

  for (const r of receipts) {
    const items = r.lineItems ?? [];
    const itemSum = items.reduce((s, it) => s + it.amount, 0);
    if (items.length > 0 && itemSum > 0.005) {
      for (const it of items) {
        add((it.category as string | undefined) || r.category, (r.totalAmount * it.amount) / itemSum);
      }
    } else {
      add(r.category, r.totalAmount);
    }
    if (isRecurringExpense(r) && r.category !== RECURRING_BUDGET_KEY) {
      add(RECURRING_BUDGET_KEY, r.totalAmount);
    }
  }
  return spend;
}
