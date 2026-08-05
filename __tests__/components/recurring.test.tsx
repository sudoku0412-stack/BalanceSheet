import React from 'react';
import { render, fireEvent, waitFor, screen } from '@testing-library/react-native';
import type { Receipt } from '../../types';

// NOTE: mocks for expo-router/lib/database/lib/secureStorage below build
// their jest.fn()s inline rather than closing over outer consts. Those
// factories return plain object literals, which run EAGERLY the moment
// the module is first required (which, thanks to ES import hoisting, can
// happen before an outer `const mock... = jest.fn()` in this file has
// actually been assigned). References to the created fns are recovered
// afterwards via the (now-mocked) module's exports.
const mockPush = jest.fn();

jest.mock('expo-router', () => ({
  useRouter: () => ({ back: jest.fn(), push: mockPush }),
  useFocusEffect: (cb: () => void) => {
    require('react').useEffect(cb, []);
  },
}));

jest.mock('@expo/vector-icons', () => ({
  Ionicons: () => null,
}));

jest.mock('../../lib/database', () => ({
  getAllReceipts: jest.fn(),
}));

jest.mock('../../lib/secureStorage', () => ({
  getCurrency: jest.fn(async () => 'USD'),
}));

import RecurringScreen from '../../app/recurring';
import { getAllReceipts } from '../../lib/database';
import { getCurrency } from '../../lib/secureStorage';

const mockGetAllReceipts = getAllReceipts as jest.Mock;
const mockGetCurrency = getCurrency as jest.Mock;

function makeReceipt(overrides: Partial<Receipt>): Receipt {
  return {
    id: 'r1',
    storeName: 'Store',
    date: '2026-01-01',
    totalAmount: 10,
    category: 'Other',
    ...overrides,
  } as Receipt;
}

describe('RecurringScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetCurrency.mockResolvedValue('USD');
  });

  it('shows the empty state when no receipt has recurring set', async () => {
    mockGetAllReceipts.mockResolvedValue([
      makeReceipt({ id: 'r1', storeName: 'Coffee Shop' }),
    ]);
    render(<RecurringScreen />);

    await waitFor(() => {
      expect(screen.getByText('No recurring expenses')).toBeTruthy();
    });
  });

  it('shows one row per templated receipt sorted by nextDueDate with frequency label', async () => {
    mockGetAllReceipts.mockResolvedValue([
      makeReceipt({
        id: 'r-later',
        storeName: 'Gym Membership',
        recurring: { frequency: 'monthly', nextDueDate: '2026-03-01', endDate: '2026-12-01' },
      }),
      makeReceipt({
        id: 'r-earlier',
        storeName: 'Newspaper',
        recurring: { frequency: 'weekly', nextDueDate: '2026-01-05', endDate: '2026-06-01' },
      }),
      makeReceipt({ id: 'r-plain', storeName: 'One off purchase' }),
    ]);
    render(<RecurringScreen />);

    await waitFor(() => {
      expect(screen.getByText('Newspaper')).toBeTruthy();
    });
    expect(screen.getByText('Gym Membership')).toBeTruthy();
    expect(screen.queryByText('One off purchase')).toBeNull();

    // Sorted by nextDueDate ascending: Newspaper (Jan 5) before Gym Membership (Mar 1).
    const names = screen.getAllByText(/Newspaper|Gym Membership/).map((n) => n.props.children);
    expect(names).toEqual(['Newspaper', 'Gym Membership']);

    expect(screen.getByText(/Weekly.*Next: Jan 5, 2026/)).toBeTruthy();
    expect(screen.getByText(/Monthly.*Next: Mar 1, 2026/)).toBeTruthy();
    expect(screen.getByText('Ends Jun 1, 2026')).toBeTruthy();
    expect(screen.getByText('Ends Dec 1, 2026')).toBeTruthy();
  });

  it('navigates to the edit screen when a row is tapped', async () => {
    mockGetAllReceipts.mockResolvedValue([
      makeReceipt({
        id: 'r-123',
        storeName: 'Streaming Service',
        recurring: { frequency: 'yearly', nextDueDate: '2026-05-01', endDate: '2027-05-01' },
      }),
    ]);
    render(<RecurringScreen />);

    await waitFor(() => {
      expect(screen.getByText('Streaming Service')).toBeTruthy();
    });
    fireEvent.press(screen.getByText('Streaming Service'));
    expect(mockPush).toHaveBeenCalledWith('/edit/r-123');
  });
});
