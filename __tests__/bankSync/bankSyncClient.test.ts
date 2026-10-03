const mockStore = new Map<string, string>();
const mockReceipts = new Map<string, Record<string, unknown>>();
const mockQueue: string[] = [];
let mockUser: { getIdToken: () => Promise<string> } | null = { getIdToken: async () => 'id-token' };
let mockEndpoint: string | undefined = 'https://bank.example/';

jest.mock('expo-constants', () => ({
  get expoConfig() {
    return { extra: { bankSyncEndpoint: mockEndpoint } };
  },
}));

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async (k: string) => mockStore.get(k) ?? null),
  setItemAsync: jest.fn(async (k: string, v: string) => {
    mockStore.set(k, v);
  }),
  deleteItemAsync: jest.fn(async (k: string) => {
    mockStore.delete(k);
  }),
}));

jest.mock('uuid', () => {
  let n = 0;
  return { v4: () => `rid-${++n}` };
});

jest.mock('../../lib/auth', () => ({ getCurrentUser: () => mockUser }));

jest.mock('../../lib/database', () => ({
  getReceiptByBankTxnId: jest.fn(async (id: string) =>
    [...mockReceipts.values()].find((r) => r.bankTxnId === id) ?? null,
  ),
  saveReceipt: jest.fn(async (r: Record<string, unknown>) => {
    mockReceipts.set(r.id as string, r);
  }),
  updateReceipt: jest.fn(async (r: Record<string, unknown>) => {
    mockReceipts.set(r.id as string, { ...r, updatedAt: 'bumped' });
  }),
  deleteReceipt: jest.fn(async (id: string) => {
    mockReceipts.delete(id);
  }),
  addToReviewQueue: jest.fn(async (id: string) => {
    mockQueue.push(id);
  }),
}));

import {
  BankSyncError,
  clearPendingLinkToken,
  completeBankLink,
  getBankSyncEndpoint,
  getPendingLinkToken,
  isBankSyncConfigured,
  listBankItems,
  removeBankItem,
  setPendingLinkToken,
  startBankLink,
  syncBankTransactions,
} from '../../lib/bankSync';

const mockFetch = jest.fn();
const reply = (data: unknown, ok = true, status = 200) => ({ ok, status, json: async () => data });

const tx = (id: string, o: Record<string, unknown> = {}) => ({
  transaction_id: id,
  amount: 20,
  iso_currency_code: 'USD',
  date: '2026-09-04',
  name: `Shop ${id}`,
  merchant_name: `Shop ${id}`,
  pending: false,
  personal_finance_category: { primary: 'GENERAL_MERCHANDISE', detailed: 'GENERAL_MERCHANDISE_OTHER' },
  ...o,
});

const syncItem = (o: Record<string, unknown> = {}) => ({
  itemId: 'item-1',
  institution: 'RBC',
  added: [],
  modified: [],
  removed: [],
  nextCursor: 'c1',
  ...o,
});

beforeEach(() => {
  jest.clearAllMocks();
  mockStore.clear();
  mockReceipts.clear();
  mockQueue.length = 0;
  mockFetch.mockReset();
  (global as unknown as { fetch: unknown }).fetch = mockFetch;
  mockUser = { getIdToken: async () => 'id-token' };
  mockEndpoint = 'https://bank.example/';
});

describe('configuration and auth', () => {
  it('reads the endpoint (trailing slashes trimmed) and reports unconfigured builds', () => {
    expect(getBankSyncEndpoint()).toBe('https://bank.example');
    expect(isBankSyncConfigured()).toBe(true);
    mockEndpoint = undefined;
    expect(isBankSyncConfigured()).toBe(false);
    mockEndpoint = '   ';
    expect(getBankSyncEndpoint()).toBeNull();
  });

  it('refuses to call out when not configured or signed out', async () => {
    mockEndpoint = undefined;
    await expect(listBankItems()).rejects.toMatchObject({ code: 'not-configured' });
    mockEndpoint = 'https://bank.example';
    mockUser = null;
    await expect(listBankItems()).rejects.toMatchObject({ code: 'signed-out' });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('sends the Firebase ID token as a Bearer header', async () => {
    mockFetch.mockResolvedValue(reply({ items: [] }));
    await listBankItems();
    expect(mockFetch).toHaveBeenCalledWith(
      'https://bank.example/v1/items',
      expect.objectContaining({ method: 'GET', headers: expect.objectContaining({ Authorization: 'Bearer id-token' }) }),
    );
  });

  it('surfaces server errors as BankSyncError with the server code', async () => {
    mockFetch.mockResolvedValue(reply({ error: 'ITEM_LOGIN_REQUIRED', message: 'relink' }, false, 502));
    await expect(listBankItems()).rejects.toMatchObject({ code: 'ITEM_LOGIN_REQUIRED', message: 'relink' });
    mockFetch.mockResolvedValue({ ok: false, status: 500, json: async () => { throw new Error('bad json'); } });
    await expect(listBankItems()).rejects.toBeInstanceOf(BankSyncError);
  });
});

describe('linking calls', () => {
  it('start / complete / remove hit the right routes with the right bodies', async () => {
    mockFetch.mockResolvedValue(reply({ linkToken: 'lt', url: 'https://hosted' }));
    await startBankLink('fr');
    expect(JSON.parse(mockFetch.mock.calls[0][1].body)).toEqual({ language: 'fr' });
    mockFetch.mockResolvedValue(reply({ connected: [], pending: true }));
    await completeBankLink('lt');
    expect(mockFetch.mock.calls[1][0]).toBe('https://bank.example/v1/complete');
    expect(JSON.parse(mockFetch.mock.calls[1][1].body)).toEqual({ linkToken: 'lt' });
    mockFetch.mockResolvedValue(reply({ ok: true }));
    await removeBankItem('item-1');
    expect(JSON.parse(mockFetch.mock.calls[2][1].body)).toEqual({ itemId: 'item-1' });
  });

  it('persists and clears the pending link token', async () => {
    expect(await getPendingLinkToken()).toBeNull();
    await setPendingLinkToken('lt');
    expect(await getPendingLinkToken()).toBe('lt');
    await clearPendingLinkToken();
    expect(await getPendingLinkToken()).toBeNull();
  });
});

describe('syncBankTransactions', () => {
  const run = (items: unknown[]) => {
    mockFetch.mockImplementation(async (url: string) =>
      url.endsWith('/v1/sync') ? reply({ items }) : reply({ ok: true }),
    );
    return syncBankTransactions('USD');
  };
  const ackBody = () => {
    const call = mockFetch.mock.calls.find((c) => String(c[0]).endsWith('/v1/ack'));
    return call ? JSON.parse(call[1].body) : null;
  };

  it('imports settled purchases into the review queue and acknowledges the cursor', async () => {
    const summary = await run([syncItem({ added: [tx('a'), tx('b')] })]);
    expect(summary).toEqual({ imported: 2, updated: 0, removed: 0, notReady: 0 });
    expect([...mockReceipts.values()].map((r) => r.bankTxnId).sort()).toEqual(['a', 'b']);
    expect(mockQueue).toHaveLength(2);
    expect(ackBody()).toEqual({ cursors: { 'item-1': 'c1' } });
  });

  it('skips pending, income, and transactions that were already imported', async () => {
    await run([syncItem({ added: [tx('a')] })]);
    const again = await run([
      syncItem({
        added: [
          tx('a'), // already imported
          tx('p', { pending: true }),
          tx('inc', { amount: -500, personal_finance_category: { primary: 'INCOME' } }),
        ],
      }),
    ]);
    expect(again.imported).toBe(0);
    expect(mockReceipts.size).toBe(1);
  });

  it('updates an untouched import when the bank changes it, but not one the user edited', async () => {
    await run([syncItem({ added: [tx('a', { amount: 20 }), tx('b', { amount: 30 })] })]);
    // user edits b (updatedAt no longer equals createdAt)
    const b = [...mockReceipts.values()].find((r) => r.bankTxnId === 'b')!;
    mockReceipts.set(b.id as string, { ...b, updatedAt: 'edited-by-user' });

    const summary = await run([syncItem({ modified: [tx('a', { amount: 22 }), tx('b', { amount: 99 })] })]);
    expect(summary.updated).toBe(1);
    const a = [...mockReceipts.values()].find((r) => r.bankTxnId === 'a')!;
    expect(a.totalAmount).toBe(22);
    expect([...mockReceipts.values()].find((r) => r.bankTxnId === 'b')!.totalAmount).toBe(30);
  });

  it('a modified transaction we never saw (e.g. a pending one that posted) is imported', async () => {
    const summary = await run([syncItem({ modified: [tx('new')] })]);
    expect(summary.imported).toBe(1);
  });

  it('removes untouched imports the bank dropped, keeps edited ones', async () => {
    await run([syncItem({ added: [tx('a'), tx('b')] })]);
    const b = [...mockReceipts.values()].find((r) => r.bankTxnId === 'b')!;
    mockReceipts.set(b.id as string, { ...b, updatedAt: 'edited' });
    const summary = await run([syncItem({ removed: ['a', 'b', 'never-imported'] })]);
    expect(summary.removed).toBe(1);
    expect([...mockReceipts.values()].map((r) => r.bankTxnId)).toEqual(['b']);
  });

  it('counts connections that are not ready and does not acknowledge them', async () => {
    const summary = await run([syncItem({ notReady: true, nextCursor: null })]);
    expect(summary.notReady).toBe(1);
    expect(ackBody()).toBeNull();
  });

  it('a failure while saving one connection leaves its cursor unacknowledged but still acks the others', async () => {
    const { saveReceipt } = jest.requireMock('../../lib/database');
    saveReceipt.mockRejectedValueOnce(new Error('disk full'));
    const summary = await run([
      syncItem({ itemId: 'bad', added: [tx('x')], nextCursor: 'cx' }),
      syncItem({ itemId: 'good', added: [tx('y')], nextCursor: 'cy' }),
    ]);
    expect(summary.imported).toBe(1);
    expect(ackBody()).toEqual({ cursors: { good: 'cy' } });
  });

  it('does nothing and does not ack when there are no connections', async () => {
    const summary = await run([]);
    expect(summary).toEqual({ imported: 0, updated: 0, removed: 0, notReady: 0 });
    expect(ackBody()).toBeNull();
  });
});
