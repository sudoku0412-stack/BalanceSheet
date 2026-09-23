export type BudgetDonutSlice = {
  key: string;
  label: string;
  amount: number;
  /** Share of `circleTotal` (0–100). */
  percentage: number;
  remaining?: boolean;
};

export type BudgetDonutModel = {
  circleTotal: number;
  remaining: number;
  remainingPct: number;
  source: 'budget' | 'income' | 'spent';
  slices: BudgetDonutSlice[];
};

/**
 * One ring = one pot (monthly budgets if set, else earned, else spent).
 * Category wedges are spend as a share of that pot. Leftover is remaining.
 */
export function computeBudgetDonut(args: {
  spentByCategory: { category: string; total: number }[];
  totalSpent: number;
  budgetTotal: number;
  earned: number;
}): BudgetDonutModel {
  const spent = Math.max(0, args.totalSpent);
  let source: BudgetDonutModel['source'] = 'spent';
  let circleTotal = spent;
  if (args.budgetTotal > 0) {
    source = 'budget';
    circleTotal = args.budgetTotal;
  } else if (args.earned > 0) {
    source = 'income';
    circleTotal = args.earned;
  }

  if (spent > circleTotal) {
    circleTotal = spent;
  }

  const remaining = Math.max(0, circleTotal - spent);
  const remainingPct = circleTotal > 0 ? (remaining / circleTotal) * 100 : 0;

  const slices: BudgetDonutSlice[] = args.spentByCategory
    .filter((c) => c.total > 0)
    .map((c) => ({
      key: c.category,
      label: c.category,
      amount: c.total,
      percentage: circleTotal > 0 ? (c.total / circleTotal) * 100 : 0,
    }))
    .sort((a, b) => b.amount - a.amount);

  if (remaining > 0.009) {
    slices.push({
      key: '__remaining',
      label: 'Remaining (unspent)',
      amount: remaining,
      percentage: remainingPct,
      remaining: true,
    });
  }

  return { circleTotal, remaining, remainingPct, source, slices };
}
