/** Bank-imported receipts keep their Plaid transaction id (local-only) so a
 *  sync can find, de-duplicate, and update them. */

type Row = Record<string, unknown>;
const mockRows: Row[] = [];
const mockLast: { sql: string; params: unknown[] }[] = [];

jest.mock('expo-sqlite', () => ({
  openDatabaseSync: () => ({
    execAsync: jest.fn(async () => undefined),
    withTransactionAsync: jest.fn(async (fn: () => Promise<void>) => fn()),
    getAllAsync: jest.fn(async () => []),
    getFirstAsync: jest.fn(async (sql: string, params: unknown[] = []) => {
      mockLast.push({ sql, params });
      if (/bank_txn_id=\?/i.test(sql)) {
        return mockRows.find((r) => r.bank_txn_id === params[0] && r.user_id === params[1]) ?? null;
      }
      return null;
    }),
    runAsync: jest.fn(async (sql: string, params: unknown[] = []) => {
      mockLast.push({ sql, params });
      if (/INSERT INTO receipts/i.test(sql) && !/ON CONFLICT/i.test(sql)) {
        mockRows.push({
          id: params[0],
          store_name: params[1],
          date: params[2],
          total_amount: params[3],
          category: params[6],
          user_id: params[20],
          household_id: params[21],
          fx_rate: params[22],
          bank_txn_id: params[23],
          created_at: params[18],
          updated_at: params[19],
        });
      }
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

import { getReceiptByBankTxnId, saveReceipt, setCurrentUserId } from '../../lib/database';

beforeEach(async () => {
  mockRows.length = 0;
  mockLast.length = 0;
  await setCurrentUserId('u1');
});

describe('bank_txn_id', () => {
  it('saveReceipt stores the bank transaction id as the last parameter', async () => {
    await saveReceipt({
      id: 'r1',
      storeName: 'Shop',
      date: '2026-09-04T12:00:00.000Z',
      totalAmount: 20,
      category: 'Other',
      bankTxnId: 'plaid-txn-1',
      createdAt: 'x',
      updatedAt: 'x',
    });
    const insert = mockLast.find((c) => /INSERT INTO receipts/i.test(c.sql))!;
    expect(insert.sql).toMatch(/bank_txn_id/);
    expect(insert.params[23]).toBe('plaid-txn-1');
    expect(mockRows[0].bank_txn_id).toBe('plaid-txn-1');
  });

  it('a manual receipt stores null', async () => {
    await saveReceipt({
      id: 'r2',
      storeName: 'Manual',
      date: '2026-09-04T12:00:00.000Z',
      totalAmount: 5,
      category: 'Other',
      createdAt: 'x',
      updatedAt: 'x',
    });
    expect(mockRows[0].bank_txn_id).toBeNull();
  });

  it('getReceiptByBankTxnId finds the signed-in user\'s receipt only', async () => {
    mockRows.push({
      id: 'r1', store_name: 'Shop', date: 'd', total_amount: 20, category: 'Other',
      user_id: 'u1', bank_txn_id: 'plaid-txn-1', created_at: 'c', updated_at: 'c',
    });
    expect(await getReceiptByBankTxnId('plaid-txn-1')).toMatchObject({ id: 'r1', bankTxnId: 'plaid-txn-1' });
    expect(await getReceiptByBankTxnId('missing')).toBeNull();
    await setCurrentUserId('u2');
    expect(await getReceiptByBankTxnId('plaid-txn-1')).toBeNull();
  });
});
