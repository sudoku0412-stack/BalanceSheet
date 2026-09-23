import React from 'react';
import { fireEvent, render, waitFor, screen } from '@testing-library/react-native';

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), back: jest.fn() },
  useFocusEffect: (cb: () => void) => {
    require('react').useEffect(cb, []);
  },
  useLocalSearchParams: () => ({}),
}));

jest.mock('@expo/vector-icons', () => ({
  Ionicons: () => null,
}));

jest.mock('../../lib/AuthContext', () => ({
  useAuth: () => ({ user: { uid: 'uid-self' } }),
}));

jest.mock('../../lib/database', () => ({
  getCurrentHouseholdId: jest.fn(() => 'hh1'),
  getAllIncomes: jest.fn(async () => []),
  searchIncomes: jest.fn(async () => []),
  deleteIncome: jest.fn(async () => {}),
}));

jest.mock('../../lib/cloudSync', () => ({
  getHouseholdMembers: jest.fn(async () => []),
}));

jest.mock('../../lib/secureStorage', () => ({
  getCurrency: jest.fn(async () => 'USD'),
}));

jest.mock('../../components/ui/Toast', () => ({
  useToast: () => ({ show: jest.fn(), dismiss: jest.fn() }),
}));

jest.mock('../../lib/dataSync', () => ({
  onLocalDataChanged: () => () => {},
}));

import { router } from 'expo-router';
import IncomesScreen from '../../app/incomes';
import { getAllIncomes } from '../../lib/database';

const mockGetAllIncomes = getAllIncomes as jest.Mock;

describe('IncomesScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetAllIncomes.mockResolvedValue([]);
  });

  it('shows an empty state when there are no incomes', async () => {
    render(<IncomesScreen />);
    await waitFor(() => {
      expect(screen.getByText('No incomes yet')).toBeTruthy();
    });
  });

  it('lists incomes with source, type, and amount', async () => {
    mockGetAllIncomes.mockResolvedValue([
      {
        id: 'i1',
        sourceName: 'Acme payroll',
        date: new Date().toISOString().slice(0, 10),
        amountUsd: 3200,
        category: 'Salary',
        earnedBy: 'uid-self',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ]);
    render(<IncomesScreen />);
    await waitFor(() => {
      expect(screen.getByText('Acme payroll')).toBeTruthy();
    });
    expect(screen.getByText(/Salary · You/)).toBeTruthy();
    expect(screen.getByText('+$3200.00')).toBeTruthy();
    fireEvent.press(screen.getByTestId('income-row-i1'));
    expect(router.push).toHaveBeenCalledWith('/edit-income/i1');
  });
});
