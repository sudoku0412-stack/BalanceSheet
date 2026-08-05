import { performance } from 'perf_hooks';
import { Receipt } from '../../types';

/**
 * Benchmark: processRecurringReceipts materializing occurrences across a
 * large number of recurring templates.
 *
 * lib/recurring.ts pulls in lib/database.ts, which opens a real
 * expo-sqlite database at import time — not available/needed under
 * Node. We mock getAllReceipts/saveReceipt/updateReceipt the same way
 * the app's own persistence boundary is mocked in other lib tests, so
 * this benchmark is pure computation: the per-template due-date
 * advancement loop, capped at 60 occurrences per template per the
 * function's own defensive guard.
 *
 * processRecurringReceipts is O(templates * occurrencesPerTemplate) —
 * each template's while-loop only touches that template's own state.
 * This guards against a future regression where, e.g., every generated
 * occurrence gets compared against every other template (which would
 * turn this quadratic in the template count).
 */

const saveReceipt = jest.fn().mockResolvedValue(undefined);
const updateReceipt = jest.fn().mockResolvedValue(undefined);
let mockReceipts: Receipt[] = [];

jest.mock('../../lib/database', () => ({
  getAllReceipts: jest.fn(() => Promise.resolve(mockReceipts)),
  saveReceipt: (...args: unknown[]) => saveReceipt(...args),
  updateReceipt: (...args: unknown[]) => updateReceipt(...args),
}));

// Import after the mock is registered.
import { processRecurringReceipts } from '../../lib/recurring';

const TEMPLATE_COUNT = 300;
// Each template's nextDueDate is far enough in the past that it hits the
// function's own 60-occurrence-per-template safety cap, so every
// template contributes the maximum amount of work.
const OCCURRENCES_PER_TEMPLATE_CAP = 60;

function isoDateDaysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

function buildTemplates(count: number): Receipt[] {
  const templates: Receipt[] = [];
  for (let i = 0; i < count; i++) {
    templates.push({
      id: `template-${i}`,
      storeName: `Recurring Vendor ${i}`,
      date: isoDateDaysAgo(500),
      totalAmount: 19.99,
      category: 'Recurring',
      lineItems: [
        { id: `${i}-a`, name: 'Subscription', amount: 19.99, category: 'Recurring' },
      ],
      recurring: {
        frequency: 'weekly',
        // Far enough in the past to need many advances to catch up to
        // today, so the while-loop actually runs up to its 60 guard.
        nextDueDate: isoDateDaysAgo(500),
        endDate: isoDateDaysAgo(-3650), // ~10 years out — never the limiter
      },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  }
  return templates;
}

describe('recurring performance', () => {
  beforeEach(() => {
    saveReceipt.mockClear();
    updateReceipt.mockClear();
  });

  it(`processes ${TEMPLATE_COUNT} recurring templates within budget`, async () => {
    mockReceipts = buildTemplates(TEMPLATE_COUNT);

    const start = performance.now();
    const created = await processRecurringReceipts();
    const durationMs = performance.now() - start;

    // Each template should hit the 60-occurrence guard given how far in
    // the past nextDueDate is.
    expect(created).toBe(TEMPLATE_COUNT * OCCURRENCES_PER_TEMPLATE_CAP);
    expect(saveReceipt).toHaveBeenCalledTimes(TEMPLATE_COUNT * OCCURRENCES_PER_TEMPLATE_CAP);

    // Generous ceiling — this is pure in-memory date arithmetic plus
    // mocked (instantly-resolving) I/O calls, so it should be fast even
    // at this scale. Catches an accidental O(templates^2) regression
    // (e.g. comparing every generated occurrence against every other
    // template).
    expect(durationMs).toBeLessThan(3000);
  });

  it('scales roughly linearly, not quadratically, with template count', async () => {
    mockReceipts = buildTemplates(40);
    const t0 = performance.now();
    await processRecurringReceipts();
    const smallMs = performance.now() - t0;

    mockReceipts = buildTemplates(320); // 8x
    const t1 = performance.now();
    await processRecurringReceipts();
    const largeMs = performance.now() - t1;

    expect(largeMs).toBeLessThan(Math.max(smallMs, 1) * 40);
  });
});
