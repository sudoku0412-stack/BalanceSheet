const mockGetInfoAsync = jest.fn();
const mockMakeDirectoryAsync = jest.fn();
const mockDeleteAsync = jest.fn();
const mockCopyAsync = jest.fn();

jest.mock('expo-file-system', () => ({
  documentDirectory: 'file:///doc/',
  getInfoAsync: (...args: unknown[]) => mockGetInfoAsync(...args),
  makeDirectoryAsync: (...args: unknown[]) => mockMakeDirectoryAsync(...args),
  deleteAsync: (...args: unknown[]) => mockDeleteAsync(...args),
  copyAsync: (...args: unknown[]) => mockCopyAsync(...args),
}));

import { persistReceiptImage, deleteReceiptImage } from '../lib/receiptPhoto';

const RECEIPT_PHOTO_DIR = 'file:///doc/receipt-photos/';

beforeEach(() => {
  jest.clearAllMocks();
  mockGetInfoAsync.mockResolvedValue({ exists: true });
  mockDeleteAsync.mockResolvedValue(undefined);
  mockCopyAsync.mockResolvedValue(undefined);
});

describe('persistReceiptImage', () => {
  it('returns undefined for falsy input', async () => {
    expect(await persistReceiptImage(undefined, 'r1')).toBeUndefined();
    expect(await persistReceiptImage(null, 'r1')).toBeUndefined();
    expect(await persistReceiptImage('', 'r1')).toBeUndefined();
  });

  it('returns the URI unchanged if already under the receipt-photos dir', async () => {
    const uri = `${RECEIPT_PHOTO_DIR}r1.jpg`;
    expect(await persistReceiptImage(uri, 'r1')).toBe(uri);
    expect(mockCopyAsync).not.toHaveBeenCalled();
  });

  it('leaves a remote http(s) URI alone', async () => {
    const uri = 'https://example.com/photo.jpg';
    expect(await persistReceiptImage(uri, 'r1')).toBe(uri);
    expect(mockCopyAsync).not.toHaveBeenCalled();
  });

  it('leaves a content:// URI alone', async () => {
    const uri = 'content://media/external/images/42';
    expect(await persistReceiptImage(uri, 'r1')).toBe(uri);
    expect(mockCopyAsync).not.toHaveBeenCalled();
  });

  it('copies a file:// URI into the stable per-id path', async () => {
    const uri = 'file:///cache/tmp123.jpg';
    const result = await persistReceiptImage(uri, 'r42');
    expect(result).toBe(`${RECEIPT_PHOTO_DIR}r42.jpg`);
    expect(mockCopyAsync).toHaveBeenCalledWith({ from: uri, to: `${RECEIPT_PHOTO_DIR}r42.jpg` });
  });

  it('creates the receipt-photos directory if it does not exist', async () => {
    mockGetInfoAsync.mockResolvedValue({ exists: false });
    await persistReceiptImage('file:///cache/tmp.jpg', 'r1');
    expect(mockMakeDirectoryAsync).toHaveBeenCalledWith(RECEIPT_PHOTO_DIR, { intermediates: true });
  });

  it('strips a query string suffix from the extension', async () => {
    const uri = 'file:///cache/tmp.png?foo=bar';
    const result = await persistReceiptImage(uri, 'r1');
    expect(result).toBe(`${RECEIPT_PHOTO_DIR}r1.pngfoobar`);
  });

  it('falls back to jpg when the extension is empty (trailing dot)', async () => {
    const uri = 'file:///cache/tmpfile.';
    const result = await persistReceiptImage(uri, 'r1');
    expect(result).toBe(`${RECEIPT_PHOTO_DIR}r1.jpg`);
  });

  it('falls back to the original URI on copy failure', async () => {
    mockCopyAsync.mockRejectedValue(new Error('disk full'));
    const uri = 'file:///cache/tmp.jpg';
    const result = await persistReceiptImage(uri, 'r1');
    expect(result).toBe(uri);
  });

  it('handles an absolute path URI (leading slash, no file:// scheme)', async () => {
    const uri = '/var/mobile/tmp.jpg';
    const result = await persistReceiptImage(uri, 'r1');
    expect(result).toBe(`${RECEIPT_PHOTO_DIR}r1.jpg`);
    expect(mockCopyAsync).toHaveBeenCalledWith({ from: uri, to: `${RECEIPT_PHOTO_DIR}r1.jpg` });
  });
});

describe('deleteReceiptImage', () => {
  it('no-ops for a falsy URI', async () => {
    await deleteReceiptImage(undefined);
    await deleteReceiptImage(null);
    await deleteReceiptImage('');
    expect(mockDeleteAsync).not.toHaveBeenCalled();
  });

  it('no-ops for a URI not owned by our receipt-photos dir', async () => {
    await deleteReceiptImage('file:///cache/other/photo.jpg');
    expect(mockDeleteAsync).not.toHaveBeenCalled();
  });

  it('deletes a URI owned by our receipt-photos dir', async () => {
    const uri = `${RECEIPT_PHOTO_DIR}r1.jpg`;
    await deleteReceiptImage(uri);
    expect(mockDeleteAsync).toHaveBeenCalledWith(uri, { idempotent: true });
  });

  it('swallows delete errors (best effort)', async () => {
    mockDeleteAsync.mockRejectedValue(new Error('gone'));
    await expect(deleteReceiptImage(`${RECEIPT_PHOTO_DIR}r1.jpg`)).resolves.toBeUndefined();
  });
});
