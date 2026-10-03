import { decryptString, encryptString } from './crypto';
import { verifyFirebaseIdToken } from './firebaseAuth';
import { PlaidClient, PlaidError, type PlaidEnv, type PlaidTransaction } from './plaid';

/** Minimal KV surface (Cloudflare KV satisfies it). */
export interface KvLike {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, opts?: { expirationTtl?: number }): Promise<void>;
  delete(key: string): Promise<void>;
}

export interface Env {
  BANK_KV: KvLike;
  PLAID_CLIENT_ID: string;
  PLAID_SECRET: string;
  PLAID_ENV: string;
  TOKEN_ENC_KEY: string;
  FIREBASE_PROJECT_ID: string;
  /** Optional https/custom-scheme URL Plaid sends the user back to. */
  LINK_REDIRECT_URI?: string;
}

export interface Deps {
  plaid?: PlaidClient;
  verify?: typeof verifyFirebaseIdToken;
}

interface StoredItem {
  itemId: string;
  institution: string;
  accessToken: string; // encrypted
  cursor: string | null;
  linkedAt: string;
}

interface UserRecord {
  items: StoredItem[];
}

const MAX_PAGES = 5;
const LINK_TOKEN_TTL_S = 4 * 60 * 60;

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });

const userKey = (uid: string) => `u:${uid}`;
const linkKey = (token: string) => `lt:${token}`;

async function loadUser(env: Env, uid: string): Promise<UserRecord> {
  const raw = await env.BANK_KV.get(userKey(uid));
  if (!raw) return { items: [] };
  try {
    const parsed = JSON.parse(raw) as UserRecord;
    return { items: Array.isArray(parsed.items) ? parsed.items : [] };
  } catch {
    return { items: [] };
  }
}

const saveUser = (env: Env, uid: string, rec: UserRecord) =>
  env.BANK_KV.put(userKey(uid), JSON.stringify(rec));

function plaidFor(env: Env, deps: Deps): PlaidClient {
  if (deps.plaid) return deps.plaid;
  const plaidEnv: PlaidEnv = env.PLAID_ENV === 'production' ? 'production' : 'sandbox';
  return new PlaidClient({ clientId: env.PLAID_CLIENT_ID, secret: env.PLAID_SECRET, env: plaidEnv });
}

async function readBody<T>(request: Request): Promise<T> {
  try {
    return (await request.json()) as T;
  } catch {
    return {} as T;
  }
}

export async function handleRequest(request: Request, env: Env, deps: Deps = {}): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;
  if (!path.startsWith('/v1/')) return json({ error: 'not found' }, 404);

  // ── authenticate ────────────────────────────────────────────────────────
  const auth = request.headers.get('Authorization') ?? '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  let uid: string;
  try {
    uid = (await (deps.verify ?? verifyFirebaseIdToken)(token, env.FIREBASE_PROJECT_ID)).uid;
  } catch {
    return json({ error: 'unauthorized' }, 401);
  }

  const plaid = plaidFor(env, deps);

  try {
    // ── start linking ──────────────────────────────────────────────────────
    if (path === '/v1/link' && request.method === 'POST') {
      const body = await readBody<{ language?: string }>(request);
      const res = await plaid.createLinkToken({
        uid,
        language: body.language === 'fr' ? 'fr' : 'en',
        redirectUri: env.LINK_REDIRECT_URI,
      });
      if (!res.hosted_link_url) return json({ error: 'hosted link unavailable' }, 502);
      await env.BANK_KV.put(linkKey(res.link_token), uid, { expirationTtl: LINK_TOKEN_TTL_S });
      return json({ linkToken: res.link_token, url: res.hosted_link_url });
    }

    // ── finish linking ─────────────────────────────────────────────────────
    if (path === '/v1/complete' && request.method === 'POST') {
      const { linkToken } = await readBody<{ linkToken?: string }>(request);
      if (!linkToken) return json({ error: 'linkToken required' }, 400);
      if ((await env.BANK_KV.get(linkKey(linkToken))) !== uid) return json({ error: 'unknown link' }, 403);

      const results = await plaid.getLinkResult(linkToken);
      if (results.length === 0) return json({ connected: [], pending: true });

      const rec = await loadUser(env, uid);
      const connected: { itemId: string; institution: string }[] = [];
      for (const r of results) {
        const ex = await plaid.exchangePublicToken(r.publicToken);
        if (!rec.items.some((i) => i.itemId === ex.item_id)) {
          rec.items.push({
            itemId: ex.item_id,
            institution: r.institution,
            accessToken: await encryptString(ex.access_token, env.TOKEN_ENC_KEY),
            cursor: null,
            linkedAt: new Date().toISOString(),
          });
        }
        connected.push({ itemId: ex.item_id, institution: r.institution });
      }
      await saveUser(env, uid, rec);
      await env.BANK_KV.delete(linkKey(linkToken));
      return json({ connected, pending: false });
    }

    // ── list ───────────────────────────────────────────────────────────────
    if (path === '/v1/items' && request.method === 'GET') {
      const rec = await loadUser(env, uid);
      return json({
        items: rec.items.map((i) => ({ itemId: i.itemId, institution: i.institution, linkedAt: i.linkedAt })),
      });
    }

    // ── pull new transactions (cursor advances only on /v1/ack) ────────────
    if (path === '/v1/sync' && request.method === 'POST') {
      const rec = await loadUser(env, uid);
      const items: {
        itemId: string;
        institution: string;
        added: PlaidTransaction[];
        modified: PlaidTransaction[];
        removed: string[];
        nextCursor: string | null;
        notReady?: boolean;
      }[] = [];
      for (const it of rec.items) {
        const accessToken = await decryptString(it.accessToken, env.TOKEN_ENC_KEY);
        let cursor = it.cursor;
        const added: PlaidTransaction[] = [];
        const modified: PlaidTransaction[] = [];
        const removed: string[] = [];
        let notReady = false;
        try {
          for (let page = 0; page < MAX_PAGES; page++) {
            const res = await plaid.syncTransactions(accessToken, cursor);
            added.push(...res.added);
            modified.push(...res.modified);
            removed.push(...res.removed.map((r) => r.transaction_id));
            cursor = res.next_cursor;
            if (!res.has_more) break;
          }
        } catch (e) {
          if (e instanceof PlaidError && e.code === 'PRODUCT_NOT_READY') notReady = true;
          else throw e;
        }
        items.push({
          itemId: it.itemId,
          institution: it.institution,
          added,
          modified,
          removed,
          nextCursor: notReady ? it.cursor : cursor,
          ...(notReady ? { notReady: true } : {}),
        });
      }
      return json({ items });
    }

    // ── client confirms it saved the data ──────────────────────────────────
    if (path === '/v1/ack' && request.method === 'POST') {
      const { cursors } = await readBody<{ cursors?: Record<string, string> }>(request);
      const rec = await loadUser(env, uid);
      for (const it of rec.items) {
        const next = cursors?.[it.itemId];
        if (typeof next === 'string') it.cursor = next;
      }
      await saveUser(env, uid, rec);
      return json({ ok: true });
    }

    // ── account deletion: revoke everything and forget the user ────────────
    if (path === '/v1/delete-all' && request.method === 'POST') {
      const rec = await loadUser(env, uid);
      for (const item of rec.items) {
        try {
          await plaid.removeItem(await decryptString(item.accessToken, env.TOKEN_ENC_KEY));
        } catch {
          // best effort: still delete our copy below
        }
      }
      await env.BANK_KV.delete(userKey(uid));
      return json({ ok: true, removed: rec.items.length });
    }

    // ── disconnect ─────────────────────────────────────────────────────────
    if (path === '/v1/remove' && request.method === 'POST') {
      const { itemId } = await readBody<{ itemId?: string }>(request);
      const rec = await loadUser(env, uid);
      const item = rec.items.find((i) => i.itemId === itemId);
      if (!item) return json({ error: 'not found' }, 404);
      try {
        await plaid.removeItem(await decryptString(item.accessToken, env.TOKEN_ENC_KEY));
      } catch {
        // already gone at the bank/Plaid: still drop it here
      }
      rec.items = rec.items.filter((i) => i.itemId !== itemId);
      await saveUser(env, uid, rec);
      return json({ ok: true });
    }
  } catch (e) {
    if (e instanceof PlaidError) return json({ error: e.code, message: e.message }, 502);
    return json({ error: 'server error' }, 500);
  }

  return json({ error: 'not found' }, 404);
}
