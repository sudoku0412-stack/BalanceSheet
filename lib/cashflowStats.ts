import { CashflowStats, Income, Receipt } from '../types';

/**
 * Household cashflow for a period: earned (sum of incomes) − spent
 * (sum of receipt totals, including Investments expenses). Per-member
 * and per-income-category breakdowns for Home / Reports.
 *
 * Pure function — pass already month-filtered lists from
 * getIncomesByMonth / getReceiptsByMonth.
 */
export function computeCashflow(incomes: Income[], receipts: Receipt[]): CashflowStats {
  const totalEarned = incomes.reduce((s, i) => s + (i.amountUsd || 0), 0);
  const totalSpent = receipts.reduce((s, r) => s + (r.totalAmount || 0), 0);

  const memberMap = new Map<string, { total: number; count: number }>();
  const catMap = new Map<string, { total: number; count: number }>();

  for (const inc of incomes) {
    const uid = inc.earnedBy || 'unknown';
    const m = memberMap.get(uid) ?? { total: 0, count: 0 };
    m.total += inc.amountUsd || 0;
    m.count += 1;
    memberMap.set(uid, m);

    const cat = inc.category || 'Other';
    const c = catMap.get(cat) ?? { total: 0, count: 0 };
    c.total += inc.amountUsd || 0;
    c.count += 1;
    catMap.set(cat, c);
  }

  const byMember = [...memberMap.entries()]
    .map(([earnedBy, v]) => ({ earnedBy, total: v.total, count: v.count }))
    .sort((a, b) => b.total - a.total);

  const byCategory = [...catMap.entries()]
    .map(([category, v]) => ({ category, total: v.total, count: v.count }))
    .sort((a, b) => b.total - a.total);

  return {
    totalEarned,
    totalSpent,
    net: totalEarned - totalSpent,
    incomeCount: incomes.length,
    byMember,
    byCategory,
  };
}
