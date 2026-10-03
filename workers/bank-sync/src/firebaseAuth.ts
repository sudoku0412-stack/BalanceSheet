import { fromBase64 } from './crypto';

const JWKS_URL =
  'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';

const subtle = (globalThis as unknown as { crypto: Crypto }).crypto.subtle;

type Jwk = { kid: string; kty: string; alg?: string; n: string; e: string };
type FetchFn = (url: string) => Promise<{ ok: boolean; json(): Promise<unknown> }>;

let cachedKeys: { keys: Jwk[]; fetchedAt: number } | null = null;
const KEYS_TTL_MS = 60 * 60 * 1000;

function b64urlToBytes(s: string): Uint8Array {
  const pad = '='.repeat((4 - (s.length % 4)) % 4);
  return fromBase64((s + pad).replace(/-/g, '+').replace(/_/g, '/'));
}

function decodeJson(part: string): Record<string, unknown> {
  return JSON.parse(new TextDecoder().decode(b64urlToBytes(part)));
}

async function getKeys(fetchFn: FetchFn, now: number): Promise<Jwk[]> {
  if (cachedKeys && now - cachedKeys.fetchedAt < KEYS_TTL_MS) return cachedKeys.keys;
  const resp = await fetchFn(JWKS_URL);
  if (!resp.ok) throw new Error('could not load Firebase signing keys');
  const body = (await resp.json()) as { keys?: Jwk[] };
  cachedKeys = { keys: body.keys ?? [], fetchedAt: now };
  return cachedKeys.keys;
}

/** Test hook. */
export function resetKeyCache(): void {
  cachedKeys = null;
}

export interface VerifiedUser {
  uid: string;
}

/**
 * Verifies a Firebase Auth ID token (RS256) against Google's published
 * keys and returns the uid, or throws. Checks signature, issuer, audience
 * (the Firebase project id), expiry and subject.
 */
export async function verifyFirebaseIdToken(
  token: string,
  projectId: string,
  opts: { fetchFn?: FetchFn; nowMs?: number } = {},
): Promise<VerifiedUser> {
  const fetchFn: FetchFn = opts.fetchFn ?? ((u) => fetch(u));
  const nowMs = opts.nowMs ?? Date.now();
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('malformed token');
  const [h, p, sig] = parts;
  const header = decodeJson(h);
  if (header.alg !== 'RS256' || typeof header.kid !== 'string') throw new Error('unsupported token');

  const jwk = (await getKeys(fetchFn, nowMs)).find((k) => k.kid === header.kid);
  if (!jwk) throw new Error('unknown signing key');
  const key = await subtle.importKey(
    'jwk',
    { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: 'RS256', ext: true },
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['verify'],
  );
  const ok = await subtle.verify(
    'RSASSA-PKCS1-v1_5',
    key,
    b64urlToBytes(sig),
    new TextEncoder().encode(`${h}.${p}`),
  );
  if (!ok) throw new Error('bad signature');

  const claims = decodeJson(p);
  const nowSec = Math.floor(nowMs / 1000);
  if (claims.iss !== `https://securetoken.google.com/${projectId}`) throw new Error('bad issuer');
  if (claims.aud !== projectId) throw new Error('bad audience');
  if (typeof claims.exp !== 'number' || claims.exp <= nowSec) throw new Error('token expired');
  if (typeof claims.iat === 'number' && claims.iat > nowSec + 300) throw new Error('token from the future');
  if (typeof claims.sub !== 'string' || !claims.sub) throw new Error('missing subject');
  return { uid: claims.sub };
}
