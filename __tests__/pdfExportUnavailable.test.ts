jest.mock('expo-print', () => {
  throw new Error('not linked');
});

import { isPdfExportAvailable } from '../lib/pdfExport';

describe('isPdfExportAvailable when expo-print is not linked', () => {
  it('returns false', () => {
    expect(isPdfExportAvailable()).toBe(false);
  });
});
