import React from 'react';
import { render, fireEvent, waitFor, screen } from '@testing-library/react-native';
import type { Receipt } from '../../types';

// NOTE: mocks below that return plain object literals (expo-router,
// expo-file-system, lib/database, lib/secureStorage, lib/pdfExport) build
// their jest.fn()s inline rather than closing over outer consts — those
// factories run eagerly at first require, which (via ES import hoisting)
// can happen before an outer `const mock... = jest.fn()` in this file has
// actually been assigned. References are recovered afterwards via the
// (now-mocked) module's exports.

jest.mock('expo-router', () => ({
  useFocusEffect: (cb: () => void) => {
    require('react').useEffect(cb, []);
  },
}));

jest.mock('@expo/vector-icons', () => ({
  Ionicons: () => null,
}));

jest.mock('expo-file-system', () => ({
  documentDirectory: 'file:///mock/',
  EncodingType: { UTF8: 'utf8' },
  writeAsStringAsync: jest.fn(async () => {}),
}));

jest.mock('../../lib/database', () => ({
  getAllReceipts: jest.fn(),
}));

jest.mock('../../lib/secureStorage', () => ({
  getCurrency: jest.fn(async () => 'USD'),
}));

jest.mock('../../lib/pdfExport', () => ({
  isPdfExportAvailable: jest.fn(() => true),
  generateReceiptsPdf: jest.fn(async () => 'file:///mock/report.pdf'),
}));

import ReportsScreen from '../../app/reports';
import { getAllReceipts } from '../../lib/database';
import { isPdfExportAvailable, generateReceiptsPdf } from '../../lib/pdfExport';

const mockGetAllReceipts = getAllReceipts as jest.Mock;
const mockIsPdfExportAvailable = isPdfExportAvailable as jest.Mock;
const mockGenerateReceiptsPdf = generateReceiptsPdf as jest.Mock;

function makeReceipt(overrides: Partial<Receipt>): Receipt {
  const now = new Date();
  return {
    id: 'r1',
    storeName: 'Store',
    date: now.toISOString().slice(0, 10),
    totalAmount: 10,
    category: 'Other',
    ...overrides,
  } as Receipt;
}

describe('ReportsScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockIsPdfExportAvailable.mockReturnValue(true);
    mockGenerateReceiptsPdf.mockResolvedValue('file:///mock/report.pdf');
  });

  it('renders the total spent and receipt count from mocked receipts in the current month', async () => {
    mockGetAllReceipts.mockResolvedValue([
      makeReceipt({ id: 'r1', totalAmount: 20, category: 'Groceries' }),
      makeReceipt({ id: 'r2', totalAmount: 30, category: 'Dining' }),
    ]);
    render(<ReportsScreen />);

    await waitFor(() => {
      expect(screen.getByText('$50.00')).toBeTruthy();
    });
    expect(screen.getByText('total across 2 expenses')).toBeTruthy();
  });

  it('shows an empty state when there are no receipts in range', async () => {
    mockGetAllReceipts.mockResolvedValue([]);
    render(<ReportsScreen />);

    await waitFor(() => {
      expect(screen.getByText('No data yet')).toBeTruthy();
    });
  });

  it('tapping Export CSV writes the file and does not touch PDF export', async () => {
    mockGetAllReceipts.mockResolvedValue([makeReceipt({ id: 'r1', totalAmount: 15 })]);
    render(<ReportsScreen />);

    await waitFor(() => {
      expect(screen.getByText('Export CSV')).toBeTruthy();
    });
    fireEvent.press(screen.getByText('Export CSV'));

    await waitFor(() => {
      expect(require('expo-file-system').writeAsStringAsync).toHaveBeenCalled();
    });
    expect(mockGenerateReceiptsPdf).not.toHaveBeenCalled();
  });

  it('tapping Export PDF calls generateReceiptsPdf when PDF export is available', async () => {
    mockGetAllReceipts.mockResolvedValue([makeReceipt({ id: 'r1', totalAmount: 15 })]);
    render(<ReportsScreen />);

    await waitFor(() => {
      expect(screen.getByText('Export PDF')).toBeTruthy();
    });
    fireEvent.press(screen.getByText('Export PDF'));

    await waitFor(() => {
      expect(mockGenerateReceiptsPdf).toHaveBeenCalled();
    });
  });
});
