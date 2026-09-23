import React from 'react';
import { fireEvent, render, waitFor, screen } from '@testing-library/react-native';

const mockReplace = jest.fn();
jest.mock('expo-router', () => ({
  router: { back: jest.fn(), replace: (...args: unknown[]) => mockReplace(...args) },
  useFocusEffect: (cb: () => void) => {
    require('react').useEffect(cb, []);
  },
}));

const mockEntitlements = { isPremium: true, loading: false };
jest.mock('../../lib/EntitlementsContext', () => ({
  useEntitlements: () => mockEntitlements,
}));

jest.mock('@expo/vector-icons', () => ({
  Ionicons: () => null,
}));

jest.mock('../../lib/database', () => ({
  getAllSavingsGoals: jest.fn(async () => []),
  saveSavingsGoal: jest.fn(async () => {}),
  deleteSavingsGoal: jest.fn(async () => {}),
}));

jest.mock('../../lib/secureStorage', () => ({
  getCurrency: jest.fn(async () => 'USD'),
}));

jest.mock('../../lib/haptics', () => ({
  notifySuccess: jest.fn(),
  tapLight: jest.fn(),
}));

jest.mock('uuid', () => ({
  v4: () => 'goal-1',
}));

import SavingsGoalsScreen from '../../app/savings-goals';
import { getAllSavingsGoals, saveSavingsGoal } from '../../lib/database';

const mockGetAll = getAllSavingsGoals as jest.Mock;
const mockSave = saveSavingsGoal as jest.Mock;

describe('SavingsGoalsScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetAll.mockResolvedValue([]);
    mockSave.mockResolvedValue(undefined);
    mockEntitlements.isPremium = true;
    mockEntitlements.loading = false;
  });

  it('sends a free-tier user to the paywall', async () => {
    mockEntitlements.isPremium = false;
    render(<SavingsGoalsScreen />);
    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith('/paywall');
    });
  });

  it('creates an envelope from name and target', async () => {
    render(<SavingsGoalsScreen />);
    await waitFor(() => screen.getByTestId('goal-name'));

    fireEvent.changeText(screen.getByTestId('goal-name'), 'Emergency fund');
    fireEvent.changeText(screen.getByTestId('goal-target'), '5000');
    fireEvent.press(screen.getByText('Add goal'));

    await waitFor(() => {
      expect(mockSave).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'goal-1',
          name: 'Emergency fund',
          targetUsd: 5000,
          allocatedUsd: 0,
        }),
      );
    });
  });

  it('lists existing envelopes with progress', async () => {
    mockGetAll.mockResolvedValue([
      {
        id: 'g1',
        name: 'Vacation',
        targetUsd: 800,
        allocatedUsd: 200,
        createdAt: '2026-03-01T00:00:00.000Z',
        updatedAt: '2026-03-01T00:00:00.000Z',
      },
    ]);
    render(<SavingsGoalsScreen />);
    await waitFor(() => {
      expect(screen.getByText('Vacation')).toBeTruthy();
    });
    expect(screen.getByText('$200.00 of $800.00 · 25%')).toBeTruthy();
  });
});
