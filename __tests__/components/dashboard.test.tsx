import React from 'react';
import { render, waitFor, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import type { Receipt } from '../../types';

/** Climbs the rendered-instance parent chain from `node` until it finds
 *  one whose flattened style carries an `elevation` key (the card-style
 *  wrapper), rather than assuming a fixed number of parent hops — which
 *  would silently point at the wrong node the next time this section's
 *  JSX nesting changes. */
function nearestCardAncestorStyle(node: { parent: any; props?: Record<string, unknown> }) {
  let current: any = node;
  while (current) {
    const flattened = StyleSheet.flatten(current.props?.style);
    if (flattened && Object.prototype.hasOwnProperty.call(flattened, 'elevation')) {
      return flattened;
    }
    current = current.parent;
  }
  throw new Error('No ancestor with an `elevation` style key was found.');
}

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

  // app/(tabs)/index.tsx gives its card surfaces (budgetCard, the
  // recent-expenses row, etc.) BOTH an iOS shadow key set
  // (shadowColor/shadowOffset/shadowOpacity/shadowRadius) and Android's
  // `elevation` on the same style object — RN itself picks the relevant
  // half per platform at native render time, so there's no Platform.OS
  // branch in JS to assert per-OS. What the restyle CAN silently drop is
  // one half of that pair; this pins down that both are still present
  // together, asserting only that the right keys exist (not their
  // literal shadow/elevation values).
  it('gives both the budget card and the recent-expenses row the full cross-platform shadow key set', async () => {
    mockGetCategoryBudgets.mockResolvedValue({ Groceries: 100 });
    mockGetReceiptsByMonth
      .mockResolvedValueOnce([
        makeReceipt({ id: 'r1', totalAmount: 40, storeName: 'Coffee Shop', category: 'Groceries' }),
      ])
      .mockResolvedValueOnce([]);
    render(<DashboardScreen />);

    await waitFor(() => {
      expect(screen.getByText('Groceries')).toBeTruthy();
    });

    const budgetCardStyle = nearestCardAncestorStyle(screen.getByText('Groceries'));
    expect(budgetCardStyle).toEqual(
      expect.objectContaining({
        shadowColor: expect.anything(),
        shadowOffset: expect.anything(),
        shadowOpacity: expect.anything(),
        shadowRadius: expect.anything(),
        elevation: expect.anything(),
      }),
    );

    const rowCardStyle = nearestCardAncestorStyle(screen.getByText('Coffee Shop'));
    expect(rowCardStyle).toEqual(
      expect.objectContaining({
        shadowColor: expect.anything(),
        shadowOffset: expect.anything(),
        shadowOpacity: expect.anything(),
        shadowRadius: expect.anything(),
        elevation: expect.anything(),
      }),
    );
  });
});
