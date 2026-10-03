import { handleRequest, type Env, type KvLike } from '../../workers/bank-sync/src/handler';
import { decryptString, toBase64 } from '../../workers/bank-sync/src/crypto';
import { PlaidClient, PlaidError, type PlaidTransaction } from '../../workers/bank-sync/src/plaid';

const KEY = toBase64(new Uint8Array(32).map((_, i) => i + 7));

function makeKv(): KvLike & { store: Map<string, string> } {
  const store = new Map<string, string>();
  return {
    store,
    get: async (k) => store.get(k) ?? null,
    put: async (k, v) => {
      store.set(k, v);
    },
    delete: async (k) => {
      store.delete(k);
    },
  };
}

const txn = (id: string, amount = 10): PlaidTransaction => ({
  transaction_id: id,
  amount,
  date: '2026-09-01',
  name: 'Shop',
  iso_currency_code: 'CAD',
});

function setup() {
  const kv = makeKv();
  const env: Env = {
    BANK_KV: kv,
    PLAID_CLIENT_ID: 'cid',
    PLAID_SECRET: 'sek',
    PLAID_ENV: 'sandbox',
    TOKEN_ENC_KEY: KEY,
    FIREBASE_PROJECT_ID: 'proj',
  };
  const plaid = {
    createLinkToken: jest.fn(async () => ({ link_token: 'link-1', hosted_link_url: 'https://hosted.plaid/x', expiration: '' })),
    getLinkResult: jest.fn(async () => [{ publicToken: 'public-1', institution: 'RBC' }]),
    exchangePublicToken: jest.fn(async () => ({ access_token: 'access-secret', item_id: 'item-1' })),
    syncTransactions: jest.fn(),
    removeItem: jest.fn(async () => ({})),
  };
  const verify = jest.fn(async (token: string) => {
    if (token === 'tok-alice') return { uid: 'alice' };
    if (token === 'tok-bob') return { uid: 'bob' };
    throw new Error('bad');
  });
  const call = (method: string, path: string, token: string | null, body?: unknown) =>
    handleRequest(
      new Request(`https://w.example${path}`, {
        method,
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          'Content-Type': 'application/json',
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
      env,
      { plaid: plaid as unknown as PlaidClient, verify: verify as never },
    );
  return { kv, env, plaid, call };
}

describe('auth', () => {
  it('rejects missing or invalid tokens and unknown paths', async () => {
    const { call } = setup();
    expect((await call('GET', '/v1/items', null)).status).toBe(401);
    expect((await call('GET', '/v1/items', 'garbage')).status).toBe(401);
    expect((await call('GET', '/nope', 'tok-alice')).status).toBe(404);
    expect((await call('GET', '/v1/unknown', 'tok-alice')).status).toBe(404);
  });
});

describe('linking', () => {
  it('creates a hosted link and remembers who it belongs to', async () => {
    const { call, plaid, kv } = setup();
    const res = await call('POST', '/v1/link', 'tok-alice', { language: 'fr' });
    expect(await res.json()).toEqual({ linkToken: 'link-1', url: 'https://hosted.plaid/x' });
    expect(plaid.createLinkToken).toHaveBeenCalledWith(expect.objectContaining({ uid: 'alice', language: 'fr' }));
    expect(kv.store.get('lt:link-1')).toBe('alice');
  });

  it('defaults to English and fails when Plaid returns no hosted link', async () => {
    const { call, plaid } = setup();
    await call('POST', '/v1/link', 'tok-alice', {});
    expect(plaid.createLinkToken).toHaveBeenCalledWith(expect.objectContaining({ language: 'en' }));
    plaid.createLinkToken.mockResolvedValueOnce({ link_token: 'x', hosted_link_url: undefined, expiration: '' } as never);
    expect((await call('POST', '/v1/link', 'tok-alice', {})).status).toBe(502);
  });

  it('completing stores the item with an encrypted token and never returns it', async () => {
    const { call, kv, env } = setup();
    await call('POST', '/v1/link', 'tok-alice', {});
    const res = await call('POST', '/v1/complete', 'tok-alice', { linkToken: 'link-1' });
    const body = await res.json();
    expect(body).toEqual({ connected: [{ itemId: 'item-1', institution: 'RBC' }], pending: false });
    expect(JSON.stringify(body)).not.toContain('access-secret');

    const stored = JSON.parse(kv.store.get('u:alice')!);
    expect(stored.items[0].accessToken).not.toContain('access-secret');
    await expect(decryptString(stored.items[0].accessToken, env.TOKEN_ENC_KEY)).resolves.toBe('access-secret');
    expect(kv.store.has('lt:link-1')).toBe(false); // link token consumed
  });

  it('reports pending while the user has not finished linking', async () => {
    const { call, plaid } = setup();
    await call('POST', '/v1/link', 'tok-alice', {});
    plaid.getLinkResult.mockResolvedValueOnce([]);
    expect(await (await call('POST', '/v1/complete', 'tok-alice', { linkToken: 'link-1' })).json()).toEqual({
      connected: [],
      pending: true,
    });
  });

  it("another user cannot complete someone else's link", async () => {
    const { call, kv } = setup();
    await call('POST', '/v1/link', 'tok-alice', {});
    expect((await call('POST', '/v1/complete', 'tok-bob', { linkToken: 'link-1' })).status).toBe(403);
    expect((await call('POST', '/v1/complete', 'tok-alice', {})).status).toBe(400);
    expect((await call('POST', '/v1/complete', 'tok-alice', { linkToken: 'unknown' })).status).toBe(403);
    expect(kv.store.has('u:bob')).toBe(false);
  });

  it('does not duplicate an item linked twice', async () => {
    const { call, kv } = setup();
    await call('POST', '/v1/link', 'tok-alice', {});
    await call('POST', '/v1/complete', 'tok-alice', { linkToken: 'link-1' });
    kv.store.set('lt:link-1', 'alice'); // simulate a retry
    await call('POST', '/v1/complete', 'tok-alice', { linkToken: 'link-1' });
    expect(JSON.parse(kv.store.get('u:alice')!).items).toHaveLength(1);
  });
});

async function linked() {
  const ctx = setup();
  await ctx.call('POST', '/v1/link', 'tok-alice', {});
  await ctx.call('POST', '/v1/complete', 'tok-alice', { linkToken: 'link-1' });
  return ctx;
}

describe('items', () => {
  it('lists only the caller\'s institutions, without tokens', async () => {
    const { call } = await linked();
    const mine = await (await call('GET', '/v1/items', 'tok-alice')).json();
    expect(mine.items).toEqual([expect.objectContaining({ itemId: 'item-1', institution: 'RBC' })]);
    expect(JSON.stringify(mine)).not.toMatch(/access|cursor/);
    expect(await (await call('GET', '/v1/items', 'tok-bob')).json()).toEqual({ items: [] });
  });
});

describe('sync + ack', () => {
  it('collects every page and returns the new cursor without saving it', async () => {
    const { call, plaid, kv } = await linked();
    plaid.syncTransactions
      .mockResolvedValueOnce({ added: [txn('t1')], modified: [], removed: [], next_cursor: 'c1', has_more: true })
      .mockResolvedValueOnce({ added: [txn('t2')], modified: [txn('t0')], removed: [{ transaction_id: 'gone' }], next_cursor: 'c2', has_more: false });
    const body = await (await call('POST', '/v1/sync', 'tok-alice', {})).json();
    expect(body.items[0]).toMatchObject({ itemId: 'item-1', nextCursor: 'c2', removed: ['gone'] });
    expect(body.items[0].added.map((t: PlaidTransaction) => t.transaction_id)).toEqual(['t1', 't2']);
    expect(body.items[0].modified).toHaveLength(1);
    // decrypted token used, and 2nd page continues from c1
    expect(plaid.syncTransactions).toHaveBeenNthCalledWith(1, 'access-secret', null);
    expect(plaid.syncTransactions).toHaveBeenNthCalledWith(2, 'access-secret', 'c1');
    // cursor NOT advanced until the app acknowledges
    expect(JSON.parse(kv.store.get('u:alice')!).items[0].cursor).toBeNull();
  });

  it('ack advances the cursor so the next sync resumes from it', async () => {
    const { call, plaid, kv } = await linked();
    await call('POST', '/v1/ack', 'tok-alice', { cursors: { 'item-1': 'c2', 'item-x': 'zzz' } });
    expect(JSON.parse(kv.store.get('u:alice')!).items[0].cursor).toBe('c2');
    plaid.syncTransactions.mockResolvedValueOnce({ added: [], modified: [], removed: [], next_cursor: 'c2', has_more: false });
    await call('POST', '/v1/sync', 'tok-alice', {});
    expect(plaid.syncTransactions).toHaveBeenCalledWith('access-secret', 'c2');
  });

  it('flags notReady (and keeps the old cursor) while Plaid is still fetching history', async () => {
    const { call, plaid } = await linked();
    plaid.syncTransactions.mockRejectedValueOnce(new PlaidError('PRODUCT_NOT_READY', 'not ready', 400));
    const body = await (await call('POST', '/v1/sync', 'tok-alice', {})).json();
    expect(body.items[0]).toMatchObject({ notReady: true, nextCursor: null, added: [] });
  });

  it('maps other Plaid errors to a 502 with the error code', async () => {
    const { call, plaid } = await linked();
    plaid.syncTransactions.mockRejectedValueOnce(new PlaidError('ITEM_LOGIN_REQUIRED', 'relink', 400));
    const res = await call('POST', '/v1/sync', 'tok-alice', {});
    expect(res.status).toBe(502);
    expect(await res.json()).toMatchObject({ error: 'ITEM_LOGIN_REQUIRED' });
  });

  it('syncs nothing for a user with no items', async () => {
    const { call } = setup();
    expect(await (await call('POST', '/v1/sync', 'tok-bob', {})).json()).toEqual({ items: [] });
  });
});

describe('remove', () => {
  it('removes at Plaid and locally, even if Plaid already dropped it', async () => {
    const { call, plaid, kv } = await linked();
    plaid.removeItem.mockRejectedValueOnce(new PlaidError('ITEM_NOT_FOUND', 'gone', 400));
    expect((await call('POST', '/v1/remove', 'tok-alice', { itemId: 'item-1' })).status).toBe(200);
    expect(plaid.removeItem).toHaveBeenCalledWith('access-secret');
    expect(JSON.parse(kv.store.get('u:alice')!).items).toEqual([]);
  });

  it('404s for an item that is not the caller\'s', async () => {
    const { call } = await linked();
    expect((await call('POST', '/v1/remove', 'tok-bob', { itemId: 'item-1' })).status).toBe(404);
    expect((await call('POST', '/v1/remove', 'tok-alice', { itemId: 'nope' })).status).toBe(404);
  });
});

describe('delete-all (account deletion)', () => {
  it('revokes every connection at Plaid and deletes the stored record', async () => {
    const { call, plaid, kv } = await linked();
    const res = await call('POST', '/v1/delete-all', 'tok-alice', {});
    expect(await res.json()).toEqual({ ok: true, removed: 1 });
    expect(plaid.removeItem).toHaveBeenCalledWith('access-secret');
    expect(kv.store.has('u:alice')).toBe(false);
  });

  it('still deletes our copy when Plaid cannot revoke, and is a no-op for users with nothing', async () => {
    const { call, plaid, kv } = await linked();
    plaid.removeItem.mockRejectedValueOnce(new PlaidError('ITEM_NOT_FOUND', 'x', 400));
    expect((await call('POST', '/v1/delete-all', 'tok-alice', {})).status).toBe(200);
    expect(kv.store.has('u:alice')).toBe(false);
    expect(await (await call('POST', '/v1/delete-all', 'tok-bob', {})).json()).toEqual({ ok: true, removed: 0 });
  });

  it("cannot touch another user's connections", async () => {
    const { call, kv } = await linked();
    await call('POST', '/v1/delete-all', 'tok-bob', {});
    expect(kv.store.has('u:alice')).toBe(true);
  });
});

describe('PlaidClient', () => {
  it('posts credentials in the body to the right host and maps errors', async () => {
    const calls: { url: string; body: Record<string, unknown> }[] = [];
    const fetchFn = jest.fn(async (url: string, init: { body: string }) => {
      calls.push({ url, body: JSON.parse(init.body) });
      return { ok: true, status: 200, json: async () => ({ link_token: 'lt', hosted_link_url: 'u', expiration: '' }) };
    });
    const client = new PlaidClient({ clientId: 'cid', secret: 'sek', env: 'sandbox' }, fetchFn as never);
    await client.createLinkToken({ uid: 'u1', language: 'en', redirectUri: 'https://r.example' });
    expect(calls[0].url).toBe('https://sandbox.plaid.com/link/token/create');
    expect(calls[0].body).toMatchObject({
      client_id: 'cid',
      secret: 'sek',
      user: { client_user_id: 'u1' },
      products: ['transactions'],
      country_codes: ['CA', 'US'],
      hosted_link: { is_mobile_app: true, completion_redirect_uri: 'https://r.example' },
    });

    const prod = new PlaidClient({ clientId: 'c', secret: 's', env: 'production' }, fetchFn as never);
    await prod.removeItem('a');
    expect(calls[1].url).toBe('https://production.plaid.com/item/remove');

    const failing = new PlaidClient(
      { clientId: 'c', secret: 's', env: 'sandbox' },
      (async () => ({ ok: false, status: 400, json: async () => ({ error_code: 'INVALID_FIELD', error_message: 'bad' }) })) as never,
    );
    await expect(failing.removeItem('a')).rejects.toMatchObject({ code: 'INVALID_FIELD', status: 400 });
  });

  it('reads institution names and public tokens from link sessions', async () => {
    const client = new PlaidClient(
      { clientId: 'c', secret: 's', env: 'sandbox' },
      (async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          link_sessions: [
            { results: { item_add_results: [{ public_token: 'p1', institution: { name: 'TD' } }, { public_token: 'p2' }] } },
            {},
          ],
        }),
      })) as never,
    );
    expect(await client.getLinkResult('lt')).toEqual([
      { publicToken: 'p1', institution: 'TD' },
      { publicToken: 'p2', institution: 'Bank' },
    ]);
  });
});
