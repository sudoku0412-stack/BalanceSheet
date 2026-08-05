import React from 'react';
import { render, fireEvent, waitFor, screen, act } from '@testing-library/react-native';
import { Alert } from 'react-native';

// NOTE: mocks below that return plain object literals (expo-router,
// lib/database, lib/cloudSync, lib/secureStorage) build their jest.fn()s
// inline rather than closing over outer consts — those factories run
// eagerly at first require, which (via ES import hoisting) can happen
// before an outer `const mock... = jest.fn()` in this file is actually
// assigned. References are recovered afterwards via the (now-mocked)
// module's exports. useAuth/useToast are safe to close over outer consts
// since they're wrapped in a function only invoked later at render time.
const mockRefreshMemberships = jest.fn(async () => {});
const mockSetActiveHousehold = jest.fn(async () => {});
const mockToastShow = jest.fn();

jest.mock('expo-router', () => ({
  useRouter: () => ({ back: jest.fn(), push: jest.fn() }),
  useFocusEffect: (cb: () => void) => {
    require('react').useEffect(cb, []);
  },
}));

jest.mock('@expo/vector-icons', () => ({
  Ionicons: () => null,
}));

// Swipeable just needs to render its children plus give the row-delete
// action a way to be pressed — the app never simulates an actual swipe
// gesture in tests, so render both the row and the (always-visible)
// right action underneath it.
jest.mock('react-native-gesture-handler', () => {
  const RN = require('react-native');
  const React = require('react');
  return {
    Swipeable: React.forwardRef(({ children, renderRightActions }: any, ref: any) => (
      <RN.View>
        {children}
        {renderRightActions ? renderRightActions() : null}
      </RN.View>
    )),
  };
});

let mockAuthValue: any;
jest.mock('../../lib/AuthContext', () => ({
  useAuth: () => mockAuthValue,
}));

jest.mock('../../components/ui/Toast', () => ({
  useToast: () => ({ show: mockToastShow, dismiss: jest.fn() }),
}));

jest.mock('../../lib/database', () => ({
  deleteAllRowsForHousehold: jest.fn(async () => {}),
  getAllReceiptsForHousehold: jest.fn(async () => []),
  getAllSettlementsForHousehold: jest.fn(async () => []),
  getCurrentHouseholdId: jest.fn(() => 'hh1'),
  insertSettlement: jest.fn(async () => {}),
}));

jest.mock('../../lib/cloudSync', () => ({
  createHousehold: jest.fn(async () => ({ ok: true, householdId: 'hh-new' })),
  deleteHousehold: jest.fn(async () => ({ ok: true })),
  getHouseholdMembers: jest.fn(async () => []),
  getUserMemberships: jest.fn(async () => []),
  renameHousehold: jest.fn(async () => ({ ok: true })),
}));

jest.mock('../../lib/secureStorage', () => ({
  clearBudgetsForHousehold: jest.fn(async () => {}),
  getCurrency: jest.fn(async () => 'USD'),
}));

jest.mock('uuid', () => ({
  v4: () => 'mock-uuid',
}));

import HouseholdsScreen from '../../app/households';
import { createHousehold, deleteHousehold, getHouseholdMembers } from '../../lib/cloudSync';
import { getAllReceiptsForHousehold, getAllSettlementsForHousehold } from '../../lib/database';

const mockCreateHousehold = createHousehold as jest.Mock;
const mockDeleteHousehold = deleteHousehold as jest.Mock;
const mockGetHouseholdMembers = getHouseholdMembers as jest.Mock;
const mockGetAllReceiptsForHousehold = getAllReceiptsForHousehold as jest.Mock;
const mockGetAllSettlementsForHousehold = getAllSettlementsForHousehold as jest.Mock;

describe('HouseholdsScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAuthValue = {
      user: { uid: 'u1' },
      memberships: [
        { householdId: 'hh1', name: 'Our Home', role: 'owner', memberCount: 2, isDefault: true },
        { householdId: 'hh2', name: 'Cabin', role: 'member', memberCount: 3, isDefault: false },
      ],
      refreshMemberships: mockRefreshMemberships,
      setActiveHousehold: mockSetActiveHousehold,
      editInProgress: false,
    };
    mockCreateHousehold.mockResolvedValue({ ok: true, householdId: 'hh-new' });
    mockDeleteHousehold.mockResolvedValue({ ok: true });
    mockGetHouseholdMembers.mockResolvedValue([]);
    mockGetAllReceiptsForHousehold.mockResolvedValue([]);
    mockGetAllSettlementsForHousehold.mockResolvedValue([]);
  });

  it('renders a list of households from mocked memberships', async () => {
    render(<HouseholdsScreen />);
    await waitFor(() => {
      expect(screen.getByText('Our Home')).toBeTruthy();
    });
    expect(screen.getByText('Cabin')).toBeTruthy();
    expect(screen.getByText('Active')).toBeTruthy();
  });

  it('creating a new household calls createHousehold and switches to it', async () => {
    render(<HouseholdsScreen />);
    await waitFor(() => screen.getByText('Our Home'));

    fireEvent.press(screen.getByLabelText('Create household'));
    fireEvent.changeText(screen.getByPlaceholderText('Household name'), 'Beach House');
    fireEvent.press(screen.getByText('Create'));

    await waitFor(() => {
      expect(mockCreateHousehold).toHaveBeenCalledWith({ uid: 'u1', name: 'Beach House' });
    });
    await waitFor(() => {
      expect(mockSetActiveHousehold).toHaveBeenCalledWith('hh-new');
    });
  });

  it('deleting an owned household with no unsettled balances shows a confirm alert before deleting', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert');
    render(<HouseholdsScreen />);
    await waitFor(() => screen.getByText('Our Home'));

    fireEvent.press(screen.getByText('Delete'));

    await waitFor(() => {
      expect(alertSpy).toHaveBeenCalledWith(
        'Delete "Our Home"?',
        expect.any(String),
        expect.arrayContaining([
          expect.objectContaining({ text: 'Cancel' }),
          expect.objectContaining({ text: 'Delete' }),
        ]),
      );
    });

    const buttons = alertSpy.mock.calls[0][2] as { text: string; onPress?: () => void }[];
    await act(async () => {
      buttons.find((b) => b.text === 'Delete')?.onPress?.();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(mockDeleteHousehold).toHaveBeenCalledWith({ householdId: 'hh1', uid: 'u1' });
    });
  });
});
