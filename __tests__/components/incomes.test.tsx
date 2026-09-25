import React from 'react';
import { Alert } from 'react-native';
import { act, fireEvent, render, waitFor, screen } from '@testing-library/react-native';

const mockParams: { current: Record<string, string> } = { current: {} };

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), back: jest.fn() },
  useFocusEffect: (cb: () => void) => {
    require('react').useEffect(cb, [cb]);
  },
  useLocalSearchParams: () => mockParams.current,
}));

jest.mock('@expo/vector-icons', () => ({
  Ionicons: () => null,
}));

jest.mock('react-native-gesture-handler', () => {
  const RN = require('react-native');
  const ReactActual = require('react');
  return {
    Swipeable: ReactActual.forwardRef(({ children, renderRightActions }: any, ref: any) => {
      ReactActual.useImperativeHandle(ref, () => ({ close: jest.fn() }));
      return (
        <RN.View>
          {children}
          {renderRightActions ? renderRightActions() : null}
        </RN.View>
      );
    }),
  };
});

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
  getHouseholdMembers: jest.fn(async () => [
    { uid: 'uid-self', displayName: 'Jane', email: 'jane@example.com', isYou: true },
    { uid: 'uid-other', displayName: 'Bob', email: 'bob@example.com', isYou: false },
  ]),
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
import { deleteIncome, getAllIncomes, searchIncomes } from '../../lib/database';
import type { Income } from '../../types';

const mockGetAllIncomes = getAllIncomes as jest.Mock;
const mockSearchIncomes = searchIncomes as jest.Mock;
const mockDeleteIncome = deleteIncome as jest.Mock;

function income(overrides: Partial<Income>): Income {
  return {
    id: 'i1',
    sourceName: 'Acme payroll',
    date: '2026-03-15',
    amountUsd: 3200,
    category: 'Salary',
    earnedBy: 'uid-self',
    createdAt: '2026-03-15T00:00:00.000Z',
    updatedAt: '2026-03-15T00:00:00.000Z',
    ...overrides,
  };
}

describe('IncomesScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockParams.current = {};
    mockGetAllIncomes.mockResolvedValue([]);
    mockSearchIncomes.mockResolvedValue([]);
    mockDeleteIncome.mockResolvedValue(undefined);
  });

  it('shows an empty state when there are no incomes', async () => {
    render(<IncomesScreen />);
    await waitFor(() => {
      expect(screen.getByText('No incomes yet')).toBeTruthy();
    });
  });

  it('lists incomes with source, type, and amount', async () => {
    mockGetAllIncomes.mockResolvedValue([income({})]);
    render(<IncomesScreen />);
    await waitFor(() => {
      expect(screen.getByText('Acme payroll')).toBeTruthy();
    });
    expect(screen.getByText(/Salary · You/)).toBeTruthy();
    expect(screen.getByText('+$3200.00')).toBeTruthy();
    fireEvent.press(screen.getByTestId('income-row-i1'));
    expect(router.push).toHaveBeenCalledWith('/edit-income/i1');
  });

  it('searches via searchIncomes instead of the full list', async () => {
    mockGetAllIncomes.mockResolvedValue([
      income({ id: 'i1', sourceName: 'Acme payroll' }),
      income({ id: 'i2', sourceName: 'Uber', amountUsd: 40, category: 'Side hustle' }),
    ]);
    render(<IncomesScreen />);
    await waitFor(() => screen.getByText('Uber'));

    mockSearchIncomes.mockResolvedValue([income({ id: 'i1', sourceName: 'Acme payroll' })]);
    fireEvent.changeText(screen.getByTestId('incomes-search'), 'acme');

    await waitFor(() => {
      expect(mockSearchIncomes).toHaveBeenCalledWith('acme');
    });
    await waitFor(() => {
      expect(screen.queryByText('Uber')).toBeNull();
    });
    expect(screen.getByText('Acme payroll')).toBeTruthy();
  });

  it('filters the list by earnedBy and calendar month from route params', async () => {
    mockParams.current = { earnedBy: 'uid-other', year: '2026', month: '3' };
    mockGetAllIncomes.mockResolvedValue([
      income({ id: 'keep', sourceName: 'Bob freelance', earnedBy: 'uid-other', date: '2026-03-10', amountUsd: 200 }),
      income({ id: 'wrong-person', sourceName: 'Jane salary', earnedBy: 'uid-self', date: '2026-03-10' }),
      income({ id: 'wrong-month', sourceName: 'Bob April', earnedBy: 'uid-other', date: '2026-04-02', amountUsd: 50 }),
    ]);
    render(<IncomesScreen />);

    await waitFor(() => {
      expect(screen.getByText('Bob freelance')).toBeTruthy();
    });
    expect(screen.queryByText('Jane salary')).toBeNull();
    expect(screen.queryByText('Bob April')).toBeNull();
    expect(screen.getByText(/1 entry/)).toBeTruthy();
    expect(screen.getByText(/Side hustle · Bob|Salary · Bob/)).toBeTruthy();
  });

  it('deletes an income after the confirm alert', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert');
    mockGetAllIncomes
      .mockResolvedValueOnce([income({ id: 'i1', sourceName: 'Acme payroll' })])
      .mockResolvedValueOnce([]);

    render(<IncomesScreen />);
    await waitFor(() => screen.getByText('Acme payroll'));

    fireEvent.press(screen.getByText('Delete'));
    expect(alertSpy).toHaveBeenCalledWith(
      'Delete income',
      expect.any(String),
      expect.arrayContaining([
        expect.objectContaining({ text: 'Cancel' }),
        expect.objectContaining({ text: 'Delete' }),
      ]),
    );

    const buttons = alertSpy.mock.calls[0][2] as { text: string; onPress?: () => void }[];
    await act(async () => {
      await buttons.find((b) => b.text === 'Delete')?.onPress?.();
    });

    await waitFor(() => {
      expect(mockDeleteIncome).toHaveBeenCalledWith('i1');
    });
    await waitFor(() => {
      expect(screen.getByText('No incomes yet')).toBeTruthy();
    });
    alertSpy.mockRestore();
  });
});
