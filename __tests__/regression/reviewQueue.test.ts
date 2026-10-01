/**
 * Review inbox: queue rows must be scoped to the signed-in user and the
 * active household, and removed along with their receipt.
 */

const runs: { sql: string; params: unknown[] }[] = [];
const queries: { sql: string; params: unknown[] }[] = [];

jest.mock('expo-sqlite', () => ({
  openDatabaseSync: () => ({
    execAsync: jest.fn(async () => undefined),
    getAllAsync: jest.fn(async (sql: string, params: unknown[] = []) => {
      queries.push({ sql, params });
      return [];
    }),
    getFirstAsync: jest.fn(async (sql: string, params: unknown[] = []) => {
      queries.push({ sql, params });
      return { n: 4 };
    }),
    withTransactionAsync: jest.fn(async (fn: () => Promise<void>) => fn()),
    runAsync: jest.fn(async (sql: string, params: unknown[] = []) => {
      runs.push({ sql, params });
      return { lastInsertRowId: 0, changes: 1 };
    }),
  }),
}));

jest.mock('../../lib/cloudSync', () => ({
  syncReceiptDeletionToCloud: jest.fn(),
  syncReceiptToCloud: jest.fn(),
  syncSettlementToCloud: jest.fn(),
  syncIncomeToCloud: jest.fn(),
  syncIncomeDeletionToCloud: jest.fn(),
  syncSavingsGoalToCloud: jest.fn(),
  syncSavingsGoalDeletionToCloud: jest.fn(),
  uploadReceiptPhoto: jest.fn(),
}));

import {
  addToReviewQueue,
  clearReviewQueue,
  deleteReceipt,
  getReviewQueueCount,
  getReviewQueueReceipts,
  removeFromReviewQueue,
  setCurrentUserId,
} from '../../lib/database';

beforeEach(async () => {
  await setCurrentUserId('u-review');
  runs.length = 0;
  queries.length = 0;
});

describe('review queue', () => {
  it('addToReviewQueue inserts idempotently', async () => {
    await addToReviewQueue('r1');
    expect(runs[0].sql).toMatch(/INSERT OR IGNORE INTO review_queue/i);
    expect(runs[0].params[0]).toBe('r1');
  });

  it('removeFromReviewQueue deletes by receipt id', async () => {
    await removeFromReviewQueue('r1');
    expect(runs[0].sql).toMatch(/DELETE FROM review_queue WHERE receipt_id=\?/i);
    expect(runs[0].params).toEqual(['r1']);
  });

  it('clearReviewQueue only touches this user\'s receipts', async () => {
    await clearReviewQueue();
    expect(runs[0].sql).toMatch(/DELETE FROM review_queue/i);
    expect(runs[0].sql).toMatch(/user_id=\?/i);
    expect(runs[0].params).toContain('u-review');
  });

  it('getReviewQueueReceipts is scoped to the user and joins the queue', async () => {
    await getReviewQueueReceipts();
    expect(queries[0].sql).toMatch(/review_queue/i);
    expect(queries[0].params).toContain('u-review');
  });

  it('getReviewQueueCount returns the row count', async () => {
    await expect(getReviewQueueCount()).resolves.toBe(4);
  });

  it('deleteReceipt also drops its queue entry', async () => {
    await deleteReceipt('r9');
    const q = runs.find((r) => /DELETE FROM review_queue/i.test(r.sql));
    expect(q).toBeDefined();
    expect(q!.params).toEqual(['r9']);
  });
});
