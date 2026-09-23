import React from 'react';
import { render, waitFor, screen } from '@testing-library/react-native';

const mockParams: { current: Record<string, string> } = { current: {} };

jest.mock('expo-router', () => ({
  router: { back: jest.fn(), push: jest.fn(), replace: jest.fn() },
  useLocalSearchParams: () => mockParams.current,
}));

jest.mock('@expo/vector-icons', () => ({
  Ionicons: () => null,
}));

jest.mock('../../lib/AuthContext', () => ({
  useAuth: () => ({ user: { uid: 'u1' } }),
}));

jest.mock('../../lib/database', () => ({
  getCurrentHouseholdId: jest.fn(() => 'hh1'),
  getRecentIncomeSourceNames: jest.fn(async () => []),
  saveIncome: jest.fn(async () => {}),
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
  v4: () => 'inc-1',
}));

import AddIncomeScreen from '../../app/add-income';

describe('AddIncomeScreen', () => {
  beforeEach(() => {
    mockParams.current = {};
  });

  it('prefills amount, date, source, and notes from pay-stub / import params', async () => {
    mockParams.current = {
      amount: '3210.55',
      date: '2026-03-15',
      sourceName: 'Acme Corp',
      category: 'Salary',
      notes: 'Scanned from pay stub',
    };
    render(<AddIncomeScreen />);

    await waitFor(() => {
      expect(screen.getByDisplayValue('3210.55')).toBeTruthy();
    });
    expect(screen.getByText('Mar 15, 2026')).toBeTruthy();
    expect(screen.getByDisplayValue('Acme Corp')).toBeTruthy();
    expect(screen.getByDisplayValue('Scanned from pay stub')).toBeTruthy();
  });
});
