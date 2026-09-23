/**
 * Account delete must wipe local incomes as well as receipts.
 */

const runs: { sql: string; params: unknown[] }[] = [];

jest.mock('expo-sqlite', () => ({
  openDatabaseSync: () => ({
    execAsync: jest.fn(async () => undefined),
    getAllAsync: jest.fn(async () => []),
    getFirstAsync: jest.fn(async () => null),
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
  uploadReceiptPhoto: jest.fn(),
}));

import { deleteAllReceipts, setCurrentUserId } from '../../lib/database';

beforeEach(async () => {
  runs.length = 0;
  await setCurrentUserId('u-delete');
  runs.length = 0;
});

describe('deleteAllReceipts', () => {
  it('deletes the signed-in user incomes in the same transaction', async () => {
    await deleteAllReceipts();
    const incomeDelete = runs.find((r) => /DELETE FROM incomes/i.test(r.sql));
    expect(incomeDelete).toBeDefined();
    expect(incomeDelete!.params).toEqual(['u-delete']);
  });
});
