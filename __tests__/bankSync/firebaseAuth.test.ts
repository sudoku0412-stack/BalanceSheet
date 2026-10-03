import { resetKeyCache, verifyFirebaseIdToken } from '../../workers/bank-sync/src/firebaseAuth';

const subtle = (globalThis as unknown as { crypto: Crypto }).crypto.subtle;
const PROJECT = 'demo-project';
const NOW_MS = 1_800_000_000_000;
const NOW_S = Math.floor(NOW_MS / 1000);

const b64url = (data: Uint8Array | string) => {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

let privateKey: CryptoKey;
let jwk: JsonWebKey;
let otherPrivateKey: CryptoKey;

beforeAll(async () => {
  const algo = { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' };
  const pair = (await subtle.generateKey(algo, true, ['sign', 'verify'])) as CryptoKeyPair;
  privateKey = pair.privateKey;
  jwk = await subtle.exportKey('jwk', pair.publicKey);
  otherPrivateKey = ((await subtle.generateKey(algo, true, ['sign', 'verify'])) as CryptoKeyPair).privateKey;
});

async function makeToken(
  claims: Record<string, unknown> = {},
  opts: { kid?: string; alg?: string; key?: CryptoKey } = {},
) {
  const header = { alg: opts.alg ?? 'RS256', kid: opts.kid ?? 'k1', typ: 'JWT' };
  const payload = {
    iss: `https://securetoken.google.com/${PROJECT}`,
    aud: PROJECT,
    sub: 'user-123',
    iat: NOW_S - 10,
    exp: NOW_S + 3600,
    ...claims,
  };
  const signingInput = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
  const sig = new Uint8Array(
    await subtle.sign('RSASSA-PKCS1-v1_5', opts.key ?? privateKey, new TextEncoder().encode(signingInput)),
  );
  return `${signingInput}.${b64url(sig)}`;
}

const fetchFn = jest.fn(async () => ({
  ok: true,
  json: async () => ({ keys: [{ ...jwk, kid: 'k1' }] }),
}));

beforeEach(() => {
  resetKeyCache();
  fetchFn.mockClear();
});

const verify = (token: string) => verifyFirebaseIdToken(token, PROJECT, { fetchFn, nowMs: NOW_MS });

describe('verifyFirebaseIdToken', () => {
  it('accepts a valid token and returns the uid', async () => {
    await expect(verify(await makeToken())).resolves.toEqual({ uid: 'user-123' });
  });

  it('caches the signing keys between calls', async () => {
    await verify(await makeToken());
    await verify(await makeToken({ sub: 'u2' }));
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('rejects a token signed by a different key', async () => {
    await expect(verify(await makeToken({}, { key: otherPrivateKey }))).rejects.toThrow(/signature/);
  });

  it('rejects wrong issuer, audience, expiry, subject, and future iat', async () => {
    await expect(verify(await makeToken({ iss: 'https://evil.example' }))).rejects.toThrow(/issuer/);
    await expect(verify(await makeToken({ aud: 'other' }))).rejects.toThrow(/audience/);
    await expect(verify(await makeToken({ exp: NOW_S - 1 }))).rejects.toThrow(/expired/);
    await expect(verify(await makeToken({ sub: '' }))).rejects.toThrow(/subject/);
    await expect(verify(await makeToken({ iat: NOW_S + 10_000 }))).rejects.toThrow(/future/);
  });

  it('rejects unknown key ids, non-RS256 algorithms, and malformed tokens', async () => {
    await expect(verify(await makeToken({}, { kid: 'nope' }))).rejects.toThrow(/signing key/);
    await expect(verify(await makeToken({}, { alg: 'none' }))).rejects.toThrow(/unsupported/);
    await expect(verify('not-a-jwt')).rejects.toThrow(/malformed/);
    await expect(verify('')).rejects.toThrow();
  });

  it('fails closed when the key endpoint is down', async () => {
    const down = jest.fn(async () => ({ ok: false, json: async () => ({}) }));
    await expect(
      verifyFirebaseIdToken(await makeToken(), PROJECT, { fetchFn: down, nowMs: NOW_MS }),
    ).rejects.toThrow(/signing keys/);
  });
});
