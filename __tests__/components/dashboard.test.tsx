import React from 'react';
import { render, waitFor, screen } from '@testing-library/react-native';
import type { Receipt } from '../../types';

// NOTE: mocks below that return plain object literals (expo-router,
// lib/database, lib/secureStorage, lib/notifications) build their
// jest.fn()s inline rather than closing over outer consts — those
// factories run eagerly at first require, which (via ES import hoisting)
// can happen before an outer `const mock... = jest.fn()` in this file is
// actually assigned. References are recovered afterwards via the
// (now-mocked) module's exports.

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), back: jest.fn(), replace: jest.fn() },
  useFocusEffect: (cb: () => void) => {
    require('react').useEffect(cb, []);
  },
}));

jest.mock('@expo/vector-icons', () => ({
  Ionicons: () => null,
}));

jest.mock('../../lib/AuthContext', () => ({
  useAuth: () => ({ memberships: [{ householdId: 'hh1', name: 'Our Home', role: 'owner', memberCount: 2, isDefault: true }] }),
}));

jest.mock('../../lib/database', () => ({
  getCurrentHouseholdId: jest.fn(() => 'hh1'),
  getReceiptsByMonth: jest.fn(),
}));

jest.mock('../../lib/secureStorage', () => ({
  getCategoryBudgets: jest.fn(async () => ({})),
  getCurrency: jest.fn(async () => 'USD'),
}));

jest.mock('../../lib/notifications', () => ({
  checkBudgetsAndNotify: jest.fn(async () => {}),
}));

// lib/recurring.ts (used unmocked, real, for RECURRING_BUDGET_KEY /
// isRecurringExpense) imports uuid, which ships ESM-only and can't be
// parsed by jest's default transform.
jest.mock('uuid', () => ({
  v4: () => 'mock-uuid',
}));

import DashboardScreen from '../../app/(tabs)/index';
import { getReceiptsByMonth } from '../../lib/database';
import { getCategoryBudgets } from '../../lib/secureStorage';

const mockGetReceiptsByMonth = getReceiptsByMonth as jest.Mock;
const mockGetCategoryBudgets = getCategoryBudgets as jest.Mock;

function makeReceipt(overrides: Partial<Receipt>): Receipt {
  return {
    id: 'r1',
    storeName: 'Coffee Shop',
    date: new Date().toISOString().slice(0, 10),
    totalAmount: 10,
    category: 'Dining',
    ...overrides,
  } as Receipt;
}

describe('DashboardScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetCategoryBudgets.mockResolvedValue({});
    // First call = current month, second call (inside load()) = previous
    // month for the trend comparison — default both to empty unless a
    // test overrides.
    mockGetReceiptsByMonth.mockResolvedValue([]);
  });

  it('renders total spent and receipt count from a mocked receipt list', async () => {
    mockGetReceiptsByMonth
      .mockResolvedValueOnce([
        makeReceipt({ id: 'r1', totalAmount: 20, storeName: 'Coffee Shop' }),
        makeReceipt({ id: 'r2', totalAmount: 30, storeName: 'Grocery Store', category: 'Groceries' }),
      ])
      .mockResolvedValueOnce([]);
    render(<DashboardScreen />);

    await waitFor(() => {
      expect(screen.getByText('$50.00')).toBeTruthy();
    });
    expect(screen.getByText('2 expenses this month')).toBeTruthy();
  });

  it('renders a recent-expenses row per receipt with its category', async () => {
    mockGetReceiptsByMonth
      .mockResolvedValueOnce([
        makeReceipt({ id: 'r1', totalAmount: 20, storeName: 'Coffee Shop', category: 'Dining' }),
        makeReceipt({ id: 'r2', totalAmount: 30, storeName: 'Grocery Store', category: 'Groceries' }),
      ])
      .mockResolvedValueOnce([]);
    render(<DashboardScreen />);

    await waitFor(() => {
      expect(screen.getByText('Coffee Shop')).toBeTruthy();
    });
    expect(screen.getByText('Grocery Store')).toBeTruthy();
    expect(screen.getByText(/Dining ·/)).toBeTruthy();
    expect(screen.getByText(/Groceries ·/)).toBeTruthy();
  });

  it('shows a budget row with its category when a budget is configured', async () => {
    mockGetCategoryBudgets.mockResolvedValue({ Groceries: 100 });
    mockGetReceiptsByMonth
      .mockResolvedValueOnce([makeReceipt({ id: 'r1', totalAmount: 40, category: 'Groceries' })])
      .mockResolvedValueOnce([]);
    render(<DashboardScreen />);

    await waitFor(() => {
      expect(screen.getByText('Budgets')).toBeTruthy();
    });
    expect(screen.getByText('Groceries')).toBeTruthy();
    expect(screen.getByText('$40.00 of $100.00')).toBeTruthy();
    expect(screen.getByText('On track')).toBeTruthy();
  });

  it('shows the empty state when there are no receipts', async () => {
    mockGetReceiptsByMonth.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    render(<DashboardScreen />);

    await waitFor(() => {
      expect(screen.getByText('No receipts yet')).toBeTruthy();
    });
  });
});
