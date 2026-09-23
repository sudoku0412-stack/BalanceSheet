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

const mockRouterPush = jest.fn();

jest.mock('expo-router', () => ({
  useFocusEffect: (cb: () => void) => {
    require('react').useEffect(cb, []);
  },
  router: { push: (...args: unknown[]) => mockRouterPush(...args) },
}));

// Defaults to Premium so the pre-existing "tapping Export PDF..." test
// below keeps exercising the real export path unchanged; the
// free-tier-gate test overrides this per-test via mockIsPremium.
const mockIsPremium = jest.fn(() => true);

jest.mock('../../lib/EntitlementsContext', () => ({
  useEntitlements: () => ({
    loading: false,
    isPremium: mockIsPremium(),
    offerings: null,
    refreshOfferings: jest.fn(),
    purchasePackage: jest.fn(),
    restorePurchases: jest.fn(),
  }),
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
  getAllIncomes: jest.fn(async () => []),
  getCurrentHouseholdId: jest.fn(() => 'hh1'),
}));

jest.mock('../../lib/secureStorage', () => ({
  getCurrency: jest.fn(async () => 'USD'),
  getCategoryBudgets: jest.fn(async () => ({})),
}));

jest.mock('../../lib/pdfExport', () => ({
  isPdfExportAvailable: jest.fn(() => true),
  generateReceiptsPdf: jest.fn(async () => 'file:///mock/report.pdf'),
}));

import ReportsScreen from '../../app/reports';
import { getAllReceipts, getAllIncomes } from '../../lib/database';
import { isPdfExportAvailable, generateReceiptsPdf } from '../../lib/pdfExport';

const mockGetAllReceipts = getAllReceipts as jest.Mock;
const mockGetAllIncomes = getAllIncomes as jest.Mock;
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
    mockGetAllIncomes.mockResolvedValue([]);
  });

  it('renders the total spent and receipt count from mocked receipts in the current month', async () => {
    mockGetAllReceipts.mockResolvedValue([
      makeReceipt({ id: 'r1', totalAmount: 20, category: 'Groceries' }),
      makeReceipt({ id: 'r2', totalAmount: 30, category: 'Dining' }),
    ]);
    mockGetAllIncomes.mockResolvedValue([
      {
        id: 'i1',
        householdId: 'hh1',
        sourceName: 'Pay',
        amountUsd: 200,
        category: 'Salary',
        earnedBy: 'self',
        date: new Date().toISOString().slice(0, 10),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ]);
    render(<ReportsScreen />);

    await waitFor(() => {
      expect(screen.getByText(/total across 2 expenses/)).toBeTruthy();
    });
    expect(screen.getAllByText('$50.00').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Earned')).toBeTruthy();
    expect(screen.getByText('Net')).toBeTruthy();
    expect(screen.getByText('Remaining (unspent)')).toBeTruthy();
    expect(screen.getByText(/One circle, one total: \$200.00/)).toBeTruthy();
    expect(screen.getByText('Groceries')).toBeTruthy();
    expect(screen.getByText('Dining')).toBeTruthy();
    expect(screen.getByText(/left · \$150.00/)).toBeTruthy();
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

  it('routes a free-tier user to the paywall instead of exporting PDF', async () => {
    mockIsPremium.mockReturnValue(false);
    try {
      mockGetAllReceipts.mockResolvedValue([makeReceipt({ id: 'r1', totalAmount: 15 })]);
      render(<ReportsScreen />);

      await waitFor(() => {
        expect(screen.getByText('Export PDF · Premium')).toBeTruthy();
      });
      fireEvent.press(screen.getByText('Export PDF · Premium'));

      await waitFor(() => {
        expect(mockRouterPush).toHaveBeenCalledWith('/paywall');
      });
      expect(mockGenerateReceiptsPdf).not.toHaveBeenCalled();
    } finally {
      // Restore the default so later test files/re-runs in this process
      // aren't affected — jest.clearAllMocks() (beforeEach) clears call
      // data but not a previously-set mockReturnValue.
      mockIsPremium.mockReturnValue(true);
    }
  });
});
