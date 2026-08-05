import { performance } from 'perf_hooks';
import { categorizeItem, detectCategory } from '../../lib/categorizer';

/**
 * Benchmark: categorizeItem / detectCategory across a large batch of
 * line items.
 *
 * Both functions score every category by scanning ITEM_CATEGORY_HINTS /
 * CATEGORY_KEYWORDS (hundreds of keyword strings) against the input.
 * That per-call cost is fixed (independent of dataset size), so calling
 * it N times should cost O(N) overall. This guards against someone
 * changing the hint-matching to something that scales with the number
 * of items processed so far (e.g. accidentally accumulating and
 * re-scanning previously seen names).
 */

const ITEM_NAMES = [
  'Organic Bananas', 'Whole Milk 2%', 'Chicken Breast Boneless', 'Sourdough Bread',
  'Tylenol Extra Strength', 'Vitamin D3 1000 IU', 'iPhone Charger Cable',
  'Bluetooth Headphones', 'Nike Running Shoes', "Men's Denim Jacket",
  'Movie Ticket Regular', 'Netflix Gift Card', 'Premium Unleaded Fuel',
  'Round Trip Flight', 'Hotel Room Night', 'Dental Checkup Copay',
  'Electric Bill Payment', 'Gym Membership Monthly', 'Frozen Pizza Pepperoni',
  'Greek Yogurt 4-Pack', 'Espresso Beans 1lb', 'Wireless Mouse',
  'Cotton T-Shirt', 'Concert Ticket', 'Diesel Fuel 15 Gallons',
];

const ITEM_COUNT = 6000;

describe('categorizer performance', () => {
  it(`categorizes ${ITEM_COUNT} line items within budget`, () => {
    const start = performance.now();
    let otherCount = 0;
    for (let i = 0; i < ITEM_COUNT; i++) {
      const name = ITEM_NAMES[i % ITEM_NAMES.length];
      const category = categorizeItem(`${name} #${i}`);
      if (category === 'Other') otherCount++;
    }
    const durationMs = performance.now() - start;

    // Sanity: most of these synthetic names should resolve to a real
    // category, not fall through to 'Other'.
    expect(otherCount).toBeLessThan(ITEM_COUNT);

    // Generous ceiling for a future O(n) -> O(n^2) regression, tuned to
    // not flake on a slower CI runner.
    expect(durationMs).toBeLessThan(2000);
  });

  it(`runs detectCategory for ${ITEM_COUNT} receipts within budget`, () => {
    const stores = ['Whole Foods', 'Best Buy', 'Shell', 'CVS Pharmacy', 'Unknown Shop LLC'];
    const start = performance.now();
    for (let i = 0; i < ITEM_COUNT; i++) {
      detectCategory(stores[i % stores.length], `Receipt body text for transaction ${i}`);
    }
    const durationMs = performance.now() - start;

    expect(durationMs).toBeLessThan(2000);
  });

  it('scales roughly linearly with item count', () => {
    const run = (n: number) => {
      const t0 = performance.now();
      for (let i = 0; i < n; i++) {
        categorizeItem(`${ITEM_NAMES[i % ITEM_NAMES.length]} #${i}`);
      }
      return performance.now() - t0;
    };

    const small = run(500);
    const large = run(4000); // 8x

    // Allow generous slack; a true O(n^2) regression would show ~64x.
    expect(large).toBeLessThan(Math.max(small, 1) * 40);
  });
});
