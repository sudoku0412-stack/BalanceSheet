import { performance } from 'perf_hooks';
import { parseReceiptText } from '../../lib/parser';

/**
 * Benchmark: parseReceiptText on a large, realistic multi-page receipt.
 *
 * parseReceiptText does several full passes over the OCR text/lines
 * (store-name scan, date/total/tax/subtotal regex scans, inline + paired
 * line-item extraction, discount-merge, tag derivation). Each pass is
 * meant to be O(n) in the number of lines/items. A future change that
 * accidentally makes any of these passes O(n^2) — e.g. re-scanning the
 * whole `lines` array per item instead of once — should show up here as
 * the threshold being blown, well before it's noticeable on a real
 * (much smaller) receipt.
 */

const ITEM_COUNT = 1500;
// Roughly 1 in 20 items gets a following markdown/discount line, which
// exercises mergeDiscountLines' backward SKU-match scan.
const DISCOUNT_EVERY = 20;

function buildSyntheticReceiptText(itemCount: number): string {
  const lines: string[] = [];
  lines.push('Costco Wholesale');
  lines.push('1234 Warehouse Ave');
  lines.push('Anytown, ST 12345');
  lines.push('08/04/2026');
  lines.push('');

  for (let i = 0; i < itemCount; i++) {
    const sku = 1000000 + i;
    const price = (5 + (i % 97) * 1.37).toFixed(2);
    lines.push(`${sku} ORGANIC ITEM NUMBER ${i} ${price}`);
    if (i % DISCOUNT_EVERY === 0 && i > 0) {
      const discount = (1 + (i % 10)).toFixed(2);
      lines.push(`TPD/${sku} ${discount}-`);
    }
  }

  const subtotal = itemCount * 10.5;
  const tax = subtotal * 0.08;
  const total = subtotal + tax;
  lines.push(`SUBTOTAL ${subtotal.toFixed(2)}`);
  lines.push(`TAX ${tax.toFixed(2)}`);
  lines.push(`TOTAL ${total.toFixed(2)}`);

  return lines.join('\n');
}

describe('parser performance', () => {
  it(`parses a ${ITEM_COUNT}-item receipt within budget`, () => {
    const text = buildSyntheticReceiptText(ITEM_COUNT);

    const start = performance.now();
    const result = parseReceiptText(text);
    const durationMs = performance.now() - start;

    // Sanity: the parser actually did work, not a no-op on malformed input.
    expect(result.lineItems.length).toBeGreaterThan(0);

    // Generous ceiling — current runs take well under this on a dev
    // machine. The goal is to catch an accidental O(n^2)/O(n^3) regression
    // (e.g. re-scanning all lines per item), not to micro-benchmark exact
    // timing, so this is set loosely enough to not flake on a slower CI
    // runner.
    expect(durationMs).toBeLessThan(1500);
  });

  it('scales roughly linearly, not quadratically, with item count', () => {
    const small = buildSyntheticReceiptText(200);
    const large = buildSyntheticReceiptText(1600); // 8x the items

    const t0 = performance.now();
    parseReceiptText(small);
    const smallMs = performance.now() - t0;

    const t1 = performance.now();
    parseReceiptText(large);
    const largeMs = performance.now() - t1;

    // With true O(n) behaviour, 8x the input should take roughly 8x as
    // long. Allow generous slack (up to 40x) so this doesn't flake on
    // noisy CI timing, but a real O(n^2) regression (which would show
    // ~64x) still trips it.
    expect(largeMs).toBeLessThan(Math.max(smallMs, 1) * 40);
  });
});
