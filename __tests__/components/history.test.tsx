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
const mockParams: Record<string, string> = {};

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, back: jest.fn() }),
  useNavigation: () => ({ setOptions: jest.fn() }),
  useLocalSearchParams: () => mockParams,
  useFocusEffect: (cb: () => void) => {
    require('react').useEffect(cb, []);
  },
}));

jest.mock('@expo/vector-icons', () => ({
  Ionicons: () => null,
}));

jest.mock('../../lib/AuthContext', () => ({
  useAuth: () => ({ user: { uid: 'uid-self' }, profile: null }),
}));

jest.mock('../../lib/cloudSync', () => ({
  getHouseholdMembers: jest.fn(async () => []),
}));

jest.mock('../../components/ui/Toast', () => ({
  useToast: () => ({ show: jest.fn(), dismiss: jest.fn() }),
}));

jest.mock('../../lib/database', () => ({
  getAllReceipts: jest.fn(),
  searchReceipts: jest.fn(),
  getAllIncomes: jest.fn(async () => []),
  searchIncomes: jest.fn(async () => []),
  deleteIncome: jest.fn(),
  getCurrentHouseholdId: jest.fn(() => null),
}));

jest.mock('../../lib/secureStorage', () => ({
  getCurrency: jest.fn(async () => 'USD'),
}));

import HistoryScreen from '../../app/(tabs)/history';
import { getAllReceipts, searchReceipts, getAllIncomes, searchIncomes } from '../../lib/database';
import type { Income } from '../../types';

const mockGetAllReceipts = getAllReceipts as jest.Mock;
const mockSearchReceipts = searchReceipts as jest.Mock;
const mockGetAllIncomes = getAllIncomes as jest.Mock;
const mockSearchIncomes = searchIncomes as jest.Mock;

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
    mockGetAllIncomes.mockResolvedValue([]);
    mockSearchIncomes.mockResolvedValue([]);
    Object.keys(mockParams).forEach((k) => delete mockParams[k]);
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
    mockSearchIncomes.mockResolvedValue([]);
    fireEvent.changeText(screen.getByPlaceholderText('Search merchant or source'), 'coffee');

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

  it('kind chips hide expenses or incomes without refetching', async () => {
    mockGetAllReceipts.mockResolvedValue([makeReceipt({ id: 'r1', storeName: 'Coffee Shop' })]);
    mockGetAllIncomes.mockResolvedValue([
      {
        id: 'i1',
        sourceName: 'Payroll',
        date: new Date().toISOString().slice(0, 10),
        amountUsd: 100,
        category: 'Salary',
        earnedBy: 'uid-self',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ]);
    render(<HistoryScreen />);
    await waitFor(() => {
      expect(screen.getByText('Coffee Shop')).toBeTruthy();
    });
    expect(screen.getByText(/Payroll/)).toBeTruthy();

    fireEvent.press(screen.getByText('Income'));
    await waitFor(() => {
      expect(screen.queryByText('Coffee Shop')).toBeNull();
    });
    expect(screen.getByText(/Payroll/)).toBeTruthy();

    fireEvent.press(screen.getByText('Expenses'));
    await waitFor(() => {
      expect(screen.getByText('Coffee Shop')).toBeTruthy();
    });
    expect(screen.queryByText(/Payroll/)).toBeNull();
    expect(mockGetAllReceipts).toHaveBeenCalledTimes(1);
    expect(mockGetAllIncomes).toHaveBeenCalledTimes(1);
  });

  it('groups incomes by earner when opened with kind=income&group=member', async () => {
    mockParams.kind = 'income';
    mockParams.group = 'member';
    const income = (overrides: Partial<Income>): Income => ({
      id: 'i1',
      sourceName: 'Payroll',
      date: new Date().toISOString().slice(0, 10),
      amountUsd: 100,
      category: 'Salary',
      earnedBy: 'uid-self',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      ...overrides,
    });
    mockGetAllIncomes.mockResolvedValue([
      income({ id: 'i1', sourceName: 'Payroll', earnedBy: 'uid-self' }),
      income({ id: 'i2', sourceName: 'Gift', earnedBy: 'uid-other', amountUsd: 40 }),
    ]);
    render(<HistoryScreen />);
    await waitFor(() => {
      expect(screen.getByText('Income by person')).toBeTruthy();
    });
    expect(screen.getByText('Payroll · You')).toBeTruthy();
    expect(screen.getByText(/Gift ·/)).toBeTruthy();
  });
});
