/** AES-GCM encryption for Plaid access tokens at rest in KV. The key comes
 *  from the TOKEN_ENC_KEY secret (base64, 32 bytes). */

const subtle = (globalThis as unknown as { crypto: Crypto }).crypto.subtle;
const randomBytes = (n: number) =>
  (globalThis as unknown as { crypto: Crypto }).crypto.getRandomValues(new Uint8Array(n));

export function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

export function fromBase64(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function importKey(base64Key: string): Promise<CryptoKey> {
  const raw = fromBase64(base64Key);
  if (raw.length !== 32) throw new Error('TOKEN_ENC_KEY must be 32 bytes, base64-encoded');
  return subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

/** Returns "iv.ciphertext" (both base64). A fresh random IV every call. */
export async function encryptString(plain: string, base64Key: string): Promise<string> {
  const key = await importKey(base64Key);
  const iv = randomBytes(12);
  const ct = new Uint8Array(
    await subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(plain)),
  );
  return `${toBase64(iv)}.${toBase64(ct)}`;
}

export async function decryptString(payload: string, base64Key: string): Promise<string> {
  const [ivB64, ctB64] = payload.split('.');
  if (!ivB64 || !ctB64) throw new Error('malformed ciphertext');
  const key = await importKey(base64Key);
  const pt = await subtle.decrypt({ name: 'AES-GCM', iv: fromBase64(ivB64) }, key, fromBase64(ctB64));
  return new TextDecoder().decode(pt);
}
