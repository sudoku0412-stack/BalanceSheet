/**
 * Regression test — "fix: dashboard category totals match drilldown
 * exactly (no tax pro-rata)" (lib/dashboardStats.ts, commit 47b805f).
 *
 * Original failure mode: computeStats scaled each line item's amount by
 * `receipt.totalAmount / sum(itemAmounts)` before adding it to its
 * category bucket, redistributing the receipt's tax proportionally
 * across items. This silently inflated every category total by
 * ~10-13% (typical sales tax) relative to the drilldown screen, which
 * shows the raw item amounts for that category with no such scaling —
 * so the dashboard's category total and the drilldown total for the
 * same category visibly disagreed.
 *
 * Fixed by using raw signed item amounts with no scaling, so the
 * dashboard category total always exactly equals sum(item.amount) for
 * that category — the same number the drilldown computes.
 *
 * This test reproduces the exact real-world scenario from the fix's
 * commit message: a receipt with total $250 (tax included) but items
 * netting to $66.98 in category "Other". Asserts the category total is
 * the raw $66.98, not scaled up toward $250.
 */
import { computeStats } from '../../lib/dashboardStats';
import { Receipt } from '../../types';

function makeReceipt(overrides: Partial<Receipt>): Receipt {
  return {
    id: 'r1',
    userId: 'u1',
    storeName: 'Costco',
    date: '2026-08-01',
    category: 'Other',
    totalAmount: 0,
    currency: 'USD',
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    ...overrides,
  } as Receipt;
}

describe('Regression: dashboard category totals have no tax pro-rata (lib/dashboardStats.ts)', () => {
  it('category total equals the raw sum of item amounts, not scaled toward the tax-inclusive receipt total', () => {
    // Total is $250 (post-tax) but the "Other" category's items net to
    // only $66.98 — matches the fix commit's own worked example.
    const receipt = makeReceipt({
      totalAmount: 250,
      lineItems: [
        { id: 'i1', name: 'Item A', amount: 69.99, category: 'Other' },
        { id: 'i2', name: 'TPD discount', amount: -15.0, category: 'Other' },
        { id: 'i3', name: 'Item B', amount: 6.99, category: 'Other' },
        { id: 'i4', name: 'Item C', amount: 5.0, category: 'Other' },
      ],
    });

    const stats = computeStats([receipt]);
    const otherCategory = stats.categories.find((c) => c.category === 'Other');

    expect(otherCategory).toBeDefined();
    // Raw signed sum: 69.99 - 15.00 + 6.99 + 5.00 = 66.98
    expect(otherCategory!.total).toBeCloseTo(66.98, 2);

    // The old scaling bug would have computed
    // scale = 250 / 66.98 ≈ 3.7333 and inflated the total toward $250 —
    // explicitly assert we're nowhere near that.
    expect(otherCategory!.total).not.toBeCloseTo(250, 0);
  });

  it('dashboard category total matches a drilldown-style raw filter+sum over the same receipts', () => {
    const receipts: Receipt[] = [
      makeReceipt({
        id: 'r1',
        totalAmount: 120,
        lineItems: [
          { id: 'i1', name: 'Groceries item', amount: 40, category: 'Groceries' },
          { id: 'i2', name: 'Electronics item', amount: 60, category: 'Electronics' },
        ],
      }),
      makeReceipt({
        id: 'r2',
        totalAmount: 55,
        lineItems: [{ id: 'i3', name: 'More groceries', amount: 50, category: 'Groceries' }],
      }),
    ];

    const stats = computeStats(receipts);
    const groceriesFromDashboard = stats.categories.find((c) => c.category === 'Groceries')!.total;

    // "Drilldown" here means: for a given category, sum the raw item
    // amounts across every receipt whose line items include it — no
    // scaling, exactly what tapping into the category screen would do.
    const groceriesFromDrilldown = receipts
      .flatMap((r) => r.lineItems ?? [])
      .filter((item) => item.category === 'Groceries')
      .reduce((sum, item) => sum + item.amount, 0);

    expect(groceriesFromDashboard).toBeCloseTo(groceriesFromDrilldown, 5);
    expect(groceriesFromDashboard).toBeCloseTo(90, 5);
  });
});
