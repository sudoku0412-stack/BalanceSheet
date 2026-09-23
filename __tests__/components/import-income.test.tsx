import React from 'react';
import { Alert } from 'react-native';
import { fireEvent, render, waitFor, screen, act } from '@testing-library/react-native';

jest.mock('expo-router', () => ({
  router: { back: jest.fn(), push: jest.fn(), replace: jest.fn() },
}));

jest.mock('@expo/vector-icons', () => ({
  Ionicons: () => null,
}));

jest.mock('../../lib/AuthContext', () => ({
  useAuth: () => ({ user: { uid: 'u1' } }),
}));

jest.mock('../../lib/database', () => ({
  getAllIncomes: jest.fn(async () => []),
  saveIncome: jest.fn(async () => {}),
}));

jest.mock('../../lib/secureStorage', () => ({
  getCurrency: jest.fn(async () => 'USD'),
}));

jest.mock('../../lib/haptics', () => ({
  notifySuccess: jest.fn(),
  tapLight: jest.fn(),
}));

jest.mock('uuid', () => ({
  v4: () => 'imported-1',
}));

import ImportIncomeScreen from '../../app/import-income';
import { saveIncome, getAllIncomes } from '../../lib/database';

const mockSaveIncome = saveIncome as jest.Mock;
const mockGetAllIncomes = getAllIncomes as jest.Mock;

describe('ImportIncomeScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetAllIncomes.mockResolvedValue([]);
    mockSaveIncome.mockResolvedValue(undefined);
  });

  it('parses a pasted CSV and imports selected deposits', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert');
    render(<ImportIncomeScreen />);

    await waitFor(() => {
      expect(screen.getByTestId('bank-csv-input')).toBeTruthy();
    });

    fireEvent.changeText(
      screen.getByTestId('bank-csv-input'),
      ['Date,Description,Amount', '2026-03-01,Acme payroll,3200.00', '2026-03-02,Groceries,-40.00'].join(
        '\n',
      ),
    );

    await waitFor(() => {
      expect(screen.getByText('Acme payroll')).toBeTruthy();
    });
    expect(screen.queryByText('Groceries')).toBeNull();

    fireEvent.press(screen.getByText(/Import 1 deposits/));

    await waitFor(() => {
      expect(mockSaveIncome).toHaveBeenCalledTimes(1);
    });
    expect(mockSaveIncome).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceName: 'Acme payroll',
        date: '2026-03-01',
        amountUsd: 3200,
        category: 'Salary',
        earnedBy: 'u1',
        notes: 'Imported from bank CSV',
      }),
    );
    expect(alertSpy).toHaveBeenCalledWith('Imported', expect.any(String), expect.any(Array));
    alertSpy.mockRestore();
  });

  it('does not re-import a deposit that already exists', async () => {
    mockGetAllIncomes.mockResolvedValue([
      {
        id: 'existing',
        sourceName: 'Acme payroll',
        date: '2026-03-01',
        amountUsd: 3200,
        category: 'Salary',
        earnedBy: 'u1',
        createdAt: '2026-03-01T00:00:00.000Z',
        updatedAt: '2026-03-01T00:00:00.000Z',
      },
    ]);
    render(<ImportIncomeScreen />);
    await waitFor(() => screen.getByTestId('bank-csv-input'));

    fireEvent.changeText(
      screen.getByTestId('bank-csv-input'),
      'Date,Description,Amount\n2026-03-01,Acme payroll,3200.00',
    );

    await waitFor(() => {
      expect(screen.getByText(/already logged/)).toBeTruthy();
    });
    await act(async () => {
      fireEvent.press(screen.getByText(/Import 0 deposits/));
    });
    expect(mockSaveIncome).not.toHaveBeenCalled();
  });
});
