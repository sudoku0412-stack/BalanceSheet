import { performance } from 'perf_hooks';
import { computeStats } from '../../lib/dashboardStats';
import { Receipt, Category, LineItem } from '../../types';

/**
 * Benchmark: computeStats aggregating a large number of receipts, each
 * with several line items, into the dashboard's category breakdown.
 *
 * computeStats does a single pass over receipts and, for each, a single
 * pass over its line items — O(totalLineItems) overall. This guards
 * against a future change that re-scans `categories`/`catMap` per
 * receipt or per item (e.g. using .find()/.some() over an
 * ever-growing array instead of the Record lookup it uses today).
 */

const CATEGORIES: Category[] = [
  'Groceries', 'Electronics', 'Dining', 'Pharmacy', 'Gas',
  'Clothing', 'Entertainment', 'Travel', 'Healthcare', 'Electricity',
];

const RECEIPT_COUNT = 2000;
const ITEMS_PER_RECEIPT = 6;

function buildReceipts(count: number, itemsPerReceipt: number): Receipt[] {
  const receipts: Receipt[] = [];
  for (let i = 0; i < count; i++) {
    const category = CATEGORIES[i % CATEGORIES.length];
    const lineItems: LineItem[] = [];
    for (let j = 0; j < itemsPerReceipt; j++) {
      lineItems.push({
        id: `${i}-${j}`,
        name: `Item ${i}-${j}`,
        amount: 3.5 + ((i + j) % 20),
        category: CATEGORIES[(i + j) % CATEGORIES.length],
      });
    }
    receipts.push({
      id: `r${i}`,
      storeName: `Store ${i % 50}`,
      date: new Date(2026, 0, 1 + (i % 28)).toISOString(),
      totalAmount: lineItems.reduce((s, it) => s + it.amount, 0),
      category,
      lineItems,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  }
  return receipts;
}

describe('dashboardStats performance', () => {
  it(`aggregates ${RECEIPT_COUNT} receipts (${RECEIPT_COUNT * ITEMS_PER_RECEIPT} line items) within budget`, () => {
    const receipts = buildReceipts(RECEIPT_COUNT, ITEMS_PER_RECEIPT);

    const start = performance.now();
    const stats = computeStats(receipts);
    const durationMs = performance.now() - start;

    expect(stats.receiptCount).toBe(RECEIPT_COUNT);
    expect(stats.categories.length).toBeGreaterThan(0);

    // Generous ceiling — well above measured local runtime, but tight
    // enough to catch an accidental O(n^2) over receipts/items.
    expect(durationMs).toBeLessThan(500);
  });

  it('scales roughly linearly, not quadratically, with receipt count', () => {
    const small = buildReceipts(250, ITEMS_PER_RECEIPT);
    const large = buildReceipts(2000, ITEMS_PER_RECEIPT); // 8x

    const t0 = performance.now();
    computeStats(small);
    const smallMs = performance.now() - t0;

    const t1 = performance.now();
    computeStats(large);
    const largeMs = performance.now() - t1;

    expect(largeMs).toBeLessThan(Math.max(smallMs, 1) * 40);
  });
});
