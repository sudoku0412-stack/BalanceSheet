import { computeBudgetSpend } from '../lib/budgetSpend';
import type { Receipt } from '../types';

const receipt = (o: Partial<Receipt>): Receipt =>
  ({
    id: 'r',
    storeName: 'Store',
    date: '2026-09-01',
    totalAmount: 100,
    category: 'Groceries',
    createdAt: '',
    updatedAt: '',
    ...o,
  }) as Receipt;

const item = (amount: number, category?: string) => ({
  id: `i${Math.random()}`,
  name: 'x',
  amount,
  category,
});

describe('computeBudgetSpend', () => {
  it('attributes a receipt without items entirely to its category', () => {
    expect(computeBudgetSpend([receipt({ totalAmount: 80, category: 'Dining' })])).toEqual({ Dining: 80 });
  });

  it('splits the full total (tax included) across item categories proportionally', () => {
    // items 60 groceries + 40 clothing = 100; receipt total 110 with tax
    const out = computeBudgetSpend([
      receipt({
        totalAmount: 110,
        lineItems: [item(60, 'Groceries'), item(40, 'Clothing')],
      }),
    ]);
    expect(out.Groceries).toBeCloseTo(66, 6);
    expect(out.Clothing).toBeCloseTo(44, 6);
    expect(out.Groceries + out.Clothing).toBeCloseTo(110, 6);
  });

  it('counts a custom category on a line item toward its own budget', () => {
    const out = computeBudgetSpend([
      receipt({
        totalAmount: 100,
        category: 'Groceries',
        lineItems: [item(70, 'Groceries'), item(30, 'Subscriptions')],
      }),
    ]);
    expect(out.Subscriptions).toBeCloseTo(30, 6);
    expect(out.Groceries).toBeCloseTo(70, 6);
  });

  it('items without their own category fall back to the receipt category', () => {
    const out = computeBudgetSpend([
      receipt({ totalAmount: 100, category: 'Dining', lineItems: [item(50), item(50, 'Gas')] }),
    ]);
    expect(out.Dining).toBeCloseTo(50, 6);
    expect(out.Gas).toBeCloseTo(50, 6);
  });

  it('a discount line reduces its category and the parts still sum to the total', () => {
    const out = computeBudgetSpend([
      receipt({ totalAmount: 90, lineItems: [item(100, 'Groceries'), item(-10, 'Clothing')] }),
    ]);
    expect(out.Groceries).toBeCloseTo(100, 6);
    expect(out.Clothing).toBeCloseTo(-10, 6);
    expect(out.Groceries + out.Clothing).toBeCloseTo(90, 6);
  });

  it('falls back to the receipt category when items do not sum to a positive amount', () => {
    expect(
      computeBudgetSpend([receipt({ totalAmount: 20, category: 'Other', lineItems: [item(0, 'Gas')] })]),
    ).toEqual({ Other: 20 });
    expect(
      computeBudgetSpend([receipt({ totalAmount: 20, category: 'Other', lineItems: [item(-5, 'Gas')] })]),
    ).toEqual({ Other: 20 });
  });

  it('adds recurring expenses to the Recurring axis too, without double-counting a Recurring category', () => {
    const rec = { frequency: 'monthly' as const, nextDueDate: '2026-10-01', endDate: '2027-01-01' };
    const out = computeBudgetSpend([
      receipt({ id: 'a', totalAmount: 50, category: 'Groceries', recurring: rec }),
      receipt({ id: 'b', totalAmount: 30, category: 'Recurring', recurring: rec }),
      receipt({ id: 'c', totalAmount: 20, category: 'Gas', isRecurringOccurrence: true }),
    ]);
    expect(out.Recurring).toBe(30 + 50 + 20);
    expect(out.Groceries).toBe(50);
    expect(out.Gas).toBe(20);
  });

  it('is empty for no receipts', () => {
    expect(computeBudgetSpend([])).toEqual({});
  });
});
