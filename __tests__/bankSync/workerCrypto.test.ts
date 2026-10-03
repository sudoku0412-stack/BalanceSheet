import { decryptString, encryptString, fromBase64, toBase64 } from '../../workers/bank-sync/src/crypto';

const KEY = toBase64(new Uint8Array(32).map((_, i) => i + 1));
const OTHER_KEY = toBase64(new Uint8Array(32).map((_, i) => 200 - i));

describe('token encryption', () => {
  it('round-trips', async () => {
    const enc = await encryptString('access-sandbox-abc', KEY);
    expect(enc).not.toContain('access-sandbox-abc');
    await expect(decryptString(enc, KEY)).resolves.toBe('access-sandbox-abc');
  });

  it('uses a fresh IV each time', async () => {
    expect(await encryptString('same', KEY)).not.toBe(await encryptString('same', KEY));
  });

  it('fails with the wrong key or tampered data', async () => {
    const enc = await encryptString('secret', KEY);
    await expect(decryptString(enc, OTHER_KEY)).rejects.toBeDefined();
    const [iv, ct] = enc.split('.');
    const tampered = `${iv}.${toBase64(fromBase64(ct).map((b, i) => (i === 0 ? b ^ 1 : b)))}`;
    await expect(decryptString(tampered, KEY)).rejects.toBeDefined();
  });

  it('rejects a key that is not 32 bytes and malformed ciphertext', async () => {
    await expect(encryptString('x', toBase64(new Uint8Array(16)))).rejects.toThrow(/32 bytes/);
    await expect(decryptString('nodot', KEY)).rejects.toThrow(/malformed/);
  });
});
