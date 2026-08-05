import React from 'react';
import { render, fireEvent, waitFor, screen } from '@testing-library/react-native';
import type { Receipt } from '../../types';

// NOTE: mocks below that return plain object literals (expo-router,
// lib/database, lib/secureStorage) build their jest.fn()s inline rather
// than closing over outer consts — those factories run eagerly at first
// require, which (via ES import hoisting) can happen before an outer
// `const mock... = jest.fn()` in this file is actually assigned.
// References are recovered afterwards via the (now-mocked) module's
// exports.
const mockPush = jest.fn();

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, back: jest.fn() }),
  useNavigation: () => ({ setOptions: jest.fn() }),
  useLocalSearchParams: () => ({}),
  useFocusEffect: (cb: () => void) => {
    require('react').useEffect(cb, []);
  },
}));

jest.mock('@expo/vector-icons', () => ({
  Ionicons: () => null,
}));

jest.mock('../../lib/database', () => ({
  getAllReceipts: jest.fn(),
  searchReceipts: jest.fn(),
}));

jest.mock('../../lib/secureStorage', () => ({
  getCurrency: jest.fn(async () => 'USD'),
}));

import HistoryScreen from '../../app/(tabs)/history';
import { getAllReceipts, searchReceipts } from '../../lib/database';

const mockGetAllReceipts = getAllReceipts as jest.Mock;
const mockSearchReceipts = searchReceipts as jest.Mock;

function makeReceipt(overrides: Partial<Receipt>): Receipt {
  return {
    id: 'r1',
    storeName: 'Store',
    date: new Date().toISOString().slice(0, 10),
    totalAmount: 10,
    category: 'Other',
    ...overrides,
  } as Receipt;
}

describe('HistoryScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetAllReceipts.mockResolvedValue([]);
    mockSearchReceipts.mockResolvedValue([]);
  });

  it('renders one row per mocked receipt', async () => {
    mockGetAllReceipts.mockResolvedValue([
      makeReceipt({ id: 'r1', storeName: 'Coffee Shop' }),
      makeReceipt({ id: 'r2', storeName: 'Grocery Store' }),
    ]);
    render(<HistoryScreen />);

    await waitFor(() => {
      expect(screen.getByText('Coffee Shop')).toBeTruthy();
    });
    expect(screen.getByText('Grocery Store')).toBeTruthy();
  });

  it('typing into the search box filters the visible list via searchReceipts', async () => {
    mockGetAllReceipts.mockResolvedValue([
      makeReceipt({ id: 'r1', storeName: 'Coffee Shop' }),
      makeReceipt({ id: 'r2', storeName: 'Grocery Store' }),
    ]);
    render(<HistoryScreen />);
    await waitFor(() => screen.getByText('Coffee Shop'));

    mockSearchReceipts.mockResolvedValue([makeReceipt({ id: 'r1', storeName: 'Coffee Shop' })]);
    fireEvent.changeText(screen.getByPlaceholderText('Search merchant'), 'coffee');

    await waitFor(() => {
      expect(mockSearchReceipts).toHaveBeenCalledWith('coffee');
    });
    await waitFor(() => {
      expect(screen.queryByText('Grocery Store')).toBeNull();
    });
    expect(screen.getByText('Coffee Shop')).toBeTruthy();
  });

  it('tapping a row navigates to the edit screen with the right id', async () => {
    mockGetAllReceipts.mockResolvedValue([makeReceipt({ id: 'r-42', storeName: 'Coffee Shop' })]);
    render(<HistoryScreen />);

    await waitFor(() => {
      expect(screen.getByText('Coffee Shop')).toBeTruthy();
    });
    fireEvent.press(screen.getByText('Coffee Shop'));
    expect(mockPush).toHaveBeenCalledWith('/edit/r-42');
  });
});
