import React from 'react';
import { Alert } from 'react-native';
import { fireEvent, render, waitFor, screen } from '@testing-library/react-native';
import type { Income } from '../../types';

const mockParams: { current: { id?: string } } = { current: { id: 'inc-1' } };

jest.mock('expo-router', () => ({
  router: { back: jest.fn(), push: jest.fn(), replace: jest.fn() },
  useLocalSearchParams: () => mockParams.current,
}));

jest.mock('@expo/vector-icons', () => ({
  Ionicons: () => null,
}));

jest.mock('../../lib/AuthContext', () => ({
  useAuth: () => ({ user: { uid: 'uid-self' } }),
}));

jest.mock('../../lib/database', () => ({
  getCurrentHouseholdId: jest.fn(() => 'hh1'),
  getIncomeById: jest.fn(async () => null),
  getRecentIncomeSourceNames: jest.fn(async () => []),
  saveIncome: jest.fn(async () => {}),
  deleteIncome: jest.fn(async () => {}),
}));

jest.mock('../../lib/cloudSync', () => ({
  getHouseholdMembers: jest.fn(async () => []),
}));

jest.mock('../../lib/secureStorage', () => ({
  getCurrency: jest.fn(async () => 'USD'),
}));

jest.mock('../../lib/haptics', () => ({
  notifySuccess: jest.fn(),
  tapLight: jest.fn(),
}));

jest.mock('uuid', () => ({
  v4: () => 'mock-uuid',
}));

import { router } from 'expo-router';
import EditIncomeScreen from '../../app/edit-income/[id]';
import { deleteIncome, getIncomeById, saveIncome } from '../../lib/database';

const mockGetIncomeById = getIncomeById as jest.Mock;
const mockSaveIncome = saveIncome as jest.Mock;
const mockDeleteIncome = deleteIncome as jest.Mock;

function makeIncome(overrides: Partial<Income> = {}): Income {
  return {
    id: 'inc-1',
    sourceName: 'Acme payroll',
    date: '2026-03-15',
    amountUsd: 3210.55,
    category: 'Salary',
    earnedBy: 'uid-self',
    notes: 'Direct deposit',
    createdBy: 'uid-self',
    createdAt: '2026-03-15T00:00:00.000Z',
    updatedAt: '2026-03-15T00:00:00.000Z',
    ...overrides,
  };
}

describe('EditIncomeScreen', () => {
  let alertSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    mockParams.current = { id: 'inc-1' };
    mockGetIncomeById.mockResolvedValue(makeIncome());
    alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  });

  afterEach(() => {
    alertSpy.mockRestore();
  });

  it('hydrates amount, date, source, and notes from the stored income', async () => {
    render(<EditIncomeScreen />);
    await waitFor(() => {
      expect(screen.getByDisplayValue('3210.55')).toBeTruthy();
    });
    expect(screen.getByText('Mar 15, 2026')).toBeTruthy();
    expect(screen.getByDisplayValue('Acme payroll')).toBeTruthy();
    expect(screen.getByDisplayValue('Direct deposit')).toBeTruthy();
  });

  it('shows not-found when the income id is missing from SQLite', async () => {
    mockGetIncomeById.mockResolvedValue(null);
    render(<EditIncomeScreen />);
    await waitFor(() => {
      expect(screen.getByText('Income not found')).toBeTruthy();
    });
    expect(screen.queryByText('Save changes')).toBeNull();
  });

  it('refuses to save a zero or empty amount', async () => {
    render(<EditIncomeScreen />);
    await waitFor(() => {
      expect(screen.getByDisplayValue('3210.55')).toBeTruthy();
    });
    fireEvent.changeText(screen.getByDisplayValue('3210.55'), '0');
    fireEvent.press(screen.getByText('Save changes'));
    expect(alertSpy).toHaveBeenCalledWith(
      'Amount required',
      'Enter a valid amount greater than zero.',
    );
    expect(mockSaveIncome).not.toHaveBeenCalled();
  });

  it('refuses to save when the source name is only whitespace', async () => {
    render(<EditIncomeScreen />);
    await waitFor(() => {
      expect(screen.getByDisplayValue('Acme payroll')).toBeTruthy();
    });
    fireEvent.changeText(screen.getByDisplayValue('Acme payroll'), '   ');
    fireEvent.press(screen.getByText('Save changes'));
    expect(alertSpy).toHaveBeenCalledWith(
      'Source required',
      'Name where this income came from.',
    );
    expect(mockSaveIncome).not.toHaveBeenCalled();
  });

  it('saves a trimmed source, converted USD amount, and keeps earnedBy/createdAt', async () => {
    render(<EditIncomeScreen />);
    await waitFor(() => {
      expect(screen.getByDisplayValue('Acme payroll')).toBeTruthy();
    });
    fireEvent.changeText(screen.getByDisplayValue('Acme payroll'), '  Acme Corp  ');
    fireEvent.changeText(screen.getByDisplayValue('3210.55'), '4000.00');
    fireEvent.press(screen.getByText('Save changes'));

    await waitFor(() => {
      expect(mockSaveIncome).toHaveBeenCalledTimes(1);
    });
    const saved = mockSaveIncome.mock.calls[0][0] as Income;
    expect(saved.id).toBe('inc-1');
    expect(saved.sourceName).toBe('Acme Corp');
    expect(saved.amountUsd).toBe(4000);
    expect(saved.date).toBe('2026-03-15');
    expect(saved.earnedBy).toBe('uid-self');
    expect(saved.createdAt).toBe('2026-03-15T00:00:00.000Z');
    expect(saved.createdBy).toBe('uid-self');
    expect(saved.recurring).toBeUndefined();
    expect(router.back).toHaveBeenCalled();
  });

  it('keeps an existing paycheck schedule when duration is left blank', async () => {
    mockGetIncomeById.mockResolvedValue(
      makeIncome({
        recurring: {
          frequency: 'biweekly',
          nextDueDate: '2026-03-29',
          endDate: '2026-12-31',
        },
      }),
    );
    render(<EditIncomeScreen />);
    await waitFor(() => {
      expect(screen.getByDisplayValue('Acme payroll')).toBeTruthy();
    });
    fireEvent.press(screen.getByText('Save changes'));
    await waitFor(() => {
      expect(mockSaveIncome).toHaveBeenCalledTimes(1);
    });
    const saved = mockSaveIncome.mock.calls[0][0] as Income;
    expect(saved.recurring).toEqual({
      frequency: 'biweekly',
      nextDueDate: '2026-03-29',
      endDate: '2026-12-31',
    });
  });

  it('deletes the income after the confirm alert', async () => {
    alertSpy.mockImplementation((_title, _message, buttons) => {
      const del = (buttons as { text: string; onPress?: () => void }[] | undefined)?.find(
        (b) => b.text === 'Delete',
      );
      del?.onPress?.();
    });
    render(<EditIncomeScreen />);
    await waitFor(() => {
      expect(screen.getByText('Delete')).toBeTruthy();
    });
    fireEvent.press(screen.getByText('Delete'));
    await waitFor(() => {
      expect(mockDeleteIncome).toHaveBeenCalledWith('inc-1');
    });
    expect(router.back).toHaveBeenCalled();
  });
});
