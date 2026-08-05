import { performance } from 'perf_hooks';
import { buildHtmlForPreview } from '../../lib/pdfExport';
import { Receipt, Category, LineItem } from '../../types';

/**
 * Benchmark: buildHtmlForPreview (the pure HTML-template builder behind
 * generateReceiptsPdf) rendering a large report.
 *
 * Uses buildHtmlForPreview directly — same approach as
 * __tests__/dump-pdf-html.test.ts — so this exercises the real template
 * logic (category aggregation + per-receipt card rendering) without
 * pulling in the native expo-print module.
 *
 * The builder does one pass to aggregate per-category totals and one
 * pass per receipt to render its card (with a nested pass over that
 * receipt's own line items only) — overall O(receipts + totalLineItems).
 * A future change that re-sorts or re-scans all receipts inside the
 * per-receipt map callback would turn this quadratic; this test would
 * catch that as the runtime blowing the threshold or the scaling
 * assertion failing.
 */

const CATEGORIES: Category[] = [
  'Groceries', 'Electronics', 'Dining', 'Pharmacy', 'Gas',
  'Clothing', 'Entertainment', 'Travel', 'Healthcare', 'Electricity',
];

const RECEIPT_COUNT = 800;
const ITEMS_PER_RECEIPT = 5;

function buildReceipts(count: number, itemsPerReceipt: number): Receipt[] {
  const receipts: Receipt[] = [];
  for (let i = 0; i < count; i++) {
    const category = CATEGORIES[i % CATEGORIES.length];
    const lineItems: LineItem[] = [];
    for (let j = 0; j < itemsPerReceipt; j++) {
      lineItems.push({
        id: `${i}-${j}`,
        name: `Item ${i}-${j} with a moderately long descriptive name`,
        amount: 2.25 + ((i + j) % 30),
        category: CATEGORIES[(i + j) % CATEGORIES.length],
      });
    }
    receipts.push({
      id: `r${i}`,
      storeName: `Store ${i % 100}`,
      date: `2026-01-${String(1 + (i % 28)).padStart(2, '0')}`,
      totalAmount: lineItems.reduce((s, it) => s + it.amount, 0),
      subtotalAmount: lineItems.reduce((s, it) => s + it.amount, 0) * 0.92,
      taxAmount: lineItems.reduce((s, it) => s + it.amount, 0) * 0.08,
      category,
      categoryTags: [category],
      lineItems,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  }
  return receipts;
}

describe('pdfExport performance', () => {
  it(`renders HTML for ${RECEIPT_COUNT} receipts within budget`, () => {
    const receipts = buildReceipts(RECEIPT_COUNT, ITEMS_PER_RECEIPT);

    const start = performance.now();
    const html = buildHtmlForPreview({
      receipts,
      startLabel: 'Jan 1, 2026',
      endLabel: 'Dec 31, 2026',
    });
    const durationMs = performance.now() - start;

    expect(html.length).toBeGreaterThan(RECEIPT_COUNT * 100);

    // Generous ceiling for string-template generation at this scale.
    expect(durationMs).toBeLessThan(1500);
  });

  it('scales roughly linearly, not quadratically, with receipt count', () => {
    const small = buildReceipts(100, ITEMS_PER_RECEIPT);
    const large = buildReceipts(800, ITEMS_PER_RECEIPT); // 8x

    const t0 = performance.now();
    buildHtmlForPreview({ receipts: small, startLabel: 'a', endLabel: 'b' });
    const smallMs = performance.now() - t0;

    const t1 = performance.now();
    buildHtmlForPreview({ receipts: large, startLabel: 'a', endLabel: 'b' });
    const largeMs = performance.now() - t1;

    expect(largeMs).toBeLessThan(Math.max(smallMs, 1) * 40);
  });
});
