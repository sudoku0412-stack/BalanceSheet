import { computeBudgetDonut } from '../lib/budgetDonut';

describe('computeBudgetDonut', () => {
  it('uses category budgets as the pot when they are set', () => {
    const model = computeBudgetDonut({
      spentByCategory: [
        { category: 'Housing', total: 1800 },
        { category: 'Groceries', total: 650 },
      ],
      totalSpent: 2450,
      budgetTotal: 6600,
      earned: 8000,
    });
    expect(model.source).toBe('budget');
    expect(model.circleTotal).toBe(6600);
    expect(model.remaining).toBe(4150);
    expect(model.remainingPct).toBeCloseTo((4150 / 6600) * 100, 5);
    expect(model.slices.find((s) => s.remaining)?.label).toBe('Remaining (unspent)');
    expect(model.slices.find((s) => s.key === 'Housing')?.percentage).toBeCloseTo(
      (1800 / 6600) * 100,
      5,
    );
  });

  it('falls back to earned when no budgets are set', () => {
    const model = computeBudgetDonut({
      spentByCategory: [{ category: 'Dining', total: 100 }],
      totalSpent: 100,
      budgetTotal: 0,
      earned: 1000,
    });
    expect(model.source).toBe('income');
    expect(model.circleTotal).toBe(1000);
    expect(model.remaining).toBe(900);
  });

  it('falls back to spent when there is no budget and no income', () => {
    const model = computeBudgetDonut({
      spentByCategory: [{ category: 'Other', total: 50 }],
      totalSpent: 50,
      budgetTotal: 0,
      earned: 0,
    });
    expect(model.source).toBe('spent');
    expect(model.circleTotal).toBe(50);
    expect(model.remaining).toBe(0);
    expect(model.slices.some((s) => s.remaining)).toBe(false);
  });

  it('grows the circle to spent when spend exceeds the pot', () => {
    const model = computeBudgetDonut({
      spentByCategory: [{ category: 'Housing', total: 2000 }],
      totalSpent: 2000,
      budgetTotal: 1500,
      earned: 1000,
    });
    expect(model.circleTotal).toBe(2000);
    expect(model.remaining).toBe(0);
    expect(model.source).toBe('budget');
  });

  it('sorts spend slices by amount descending and appends remaining last', () => {
    const model = computeBudgetDonut({
      spentByCategory: [
        { category: 'Food', total: 50 },
        { category: 'Housing', total: 200 },
      ],
      totalSpent: 250,
      budgetTotal: 400,
      earned: 0,
    });
    expect(model.slices.map((s) => s.key)).toEqual(['Housing', 'Food', '__remaining']);
  });
});
