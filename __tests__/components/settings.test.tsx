import React from 'react';
import { render, fireEvent, waitFor, screen, act } from '@testing-library/react-native';
import { Alert } from 'react-native';

// NOTE: mocks that return plain object literals (expo-router, expo-file-
// system, lib/database, lib/secureStorage, lib/notifications, lib/cloudSync,
// lib/contactPicker, lib/phoneInvite) build their jest.fn()s inline rather
// than closing over outer consts — those factories run EAGERLY at first
// require (which, via ES import hoisting, can happen before an outer
// `const mock... = jest.fn()` in this file is actually assigned). We
// recover references to the created fns afterwards via the (now-mocked)
// module's exports. useAuth/useToast are safe to close over outer consts
// since they're wrapped in a function only invoked later at render time.
const mockSignOut = jest.fn();
const mockRefreshProfile = jest.fn(async () => {});
const mockSetActiveHousehold = jest.fn(async () => {});
const mockToastShow = jest.fn();

jest.mock('expo-router', () => ({
  useRouter: () => ({ back: jest.fn(), push: jest.fn(), replace: jest.fn() }),
  useFocusEffect: (cb: () => void) => {
    require('react').useEffect(cb, []);
  },
}));

jest.mock('@expo/vector-icons', () => ({
  Ionicons: () => null,
}));

jest.mock('expo-file-system', () => ({
  documentDirectory: 'file:///mock/',
  EncodingType: { UTF8: 'utf8' },
  writeAsStringAsync: jest.fn(async () => {}),
}));

jest.mock('../../lib/AuthContext', () => ({
  useAuth: () => ({
    user: { uid: 'u1', email: 'jane@example.com', displayName: 'Jane Doe' },
    profile: { firstName: 'Jane', lastName: 'Doe', phone: null },
    signOut: mockSignOut,
    refreshProfile: mockRefreshProfile,
    setActiveHousehold: mockSetActiveHousehold,
  }),
}));

jest.mock('../../components/ui/Toast', () => ({
  useToast: () => ({ show: mockToastShow, dismiss: jest.fn() }),
}));

jest.mock('../../lib/database', () => ({
  getAllReceipts: jest.fn(async () => []),
  getCurrentHouseholdId: jest.fn(() => 'hh1'),
}));

jest.mock('../../lib/secureStorage', () => ({
  getBudgetAlertsEnabled: jest.fn(async () => true),
  getBudgetsSnapshot: jest.fn(async () => ({ byCategory: {}, alertsEnabled: true })),
  getCategoryBudgets: jest.fn(async () => ({})),
  getCurrency: jest.fn(async () => 'USD'),
  setBudgetAlertsEnabled: jest.fn(async () => {}),
  setCategoryBudget: jest.fn(async () => {}),
  setCurrency: jest.fn(async () => {}),
}));

jest.mock('../../lib/notifications', () => ({
  registerForPushNotificationsAsync: jest.fn(async () => null),
  requestNotificationPermission: jest.fn(async () => true),
}));

jest.mock('../../lib/cloudSync', () => ({
  getHouseholdMembers: jest.fn(async () => []),
  inviteUserToHousehold: jest.fn(async () => ({ ok: true })),
  isCloudSyncAvailable: jest.fn(() => true),
  leaveHousehold: jest.fn(async () => ({ ok: true, nextActiveHouseholdId: 'hh-solo' })),
  syncBudgetsToCloud: jest.fn(async () => {}),
  syncPushTokenToCloud: jest.fn(async () => {}),
}));

jest.mock('../../lib/reports', () => ({
  receiptsToCsv: jest.fn(() => 'store,amount\n'),
}));

jest.mock('../../lib/contactPicker', () => ({
  pickContactWithPhone: jest.fn(async () => null),
  isContactPickerAvailable: jest.fn(() => true),
}));

jest.mock('../../lib/phoneInvite', () => ({
  addByPhone: jest.fn(async () => ({ ok: true, matched: false, inviteText: 'join me' })),
}));

jest.mock('uuid', () => ({
  v4: () => 'mock-uuid',
}));

import SettingsScreen from '../../app/settings';
import { getHouseholdMembers, inviteUserToHousehold, leaveHousehold } from '../../lib/cloudSync';
import { getAllReceipts } from '../../lib/database';
import { setBudgetAlertsEnabled } from '../../lib/secureStorage';
import { requestNotificationPermission } from '../../lib/notifications';

const mockGetHouseholdMembers = getHouseholdMembers as jest.Mock;
const mockInviteUserToHousehold = inviteUserToHousehold as jest.Mock;
const mockLeaveHousehold = leaveHousehold as jest.Mock;
const mockGetAllReceipts = getAllReceipts as jest.Mock;
const mockSetBudgetAlertsEnabled = setBudgetAlertsEnabled as jest.Mock;
const mockRequestNotificationPermission = requestNotificationPermission as jest.Mock;

describe('SettingsScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetHouseholdMembers.mockResolvedValue([]);
    mockInviteUserToHousehold.mockResolvedValue({ ok: true });
    mockLeaveHousehold.mockResolvedValue({ ok: true, nextActiveHouseholdId: 'hh-solo' });
    mockGetAllReceipts.mockResolvedValue([]);
    mockSetBudgetAlertsEnabled.mockResolvedValue(undefined);
    mockRequestNotificationPermission.mockResolvedValue(true);
  });

  it('renders without crashing for a signed-in user with a profile', async () => {
    render(<SettingsScreen />);
    await waitFor(() => {
      expect(screen.getByText('Settings')).toBeTruthy();
    });
    expect(screen.getByText('Jane Doe')).toBeTruthy();
    expect(screen.getByText('jane@example.com')).toBeTruthy();
    expect(screen.getByText('Sign out')).toBeTruthy();
  });

  it('sending an email invite calls inviteUserToHousehold and shows a success toast', async () => {
    render(<SettingsScreen />);
    await waitFor(() => screen.getByText('Settings'));

    fireEvent.changeText(screen.getByPlaceholderText('Invite by email'), 'friend@example.com');
    fireEvent.press(screen.getByText('Send'));

    await waitFor(() => {
      expect(mockInviteUserToHousehold).toHaveBeenCalledWith(
        expect.objectContaining({ email: 'friend@example.com', invitedByUid: 'u1' }),
      );
    });
    await waitFor(() => {
      expect(mockToastShow).toHaveBeenCalledWith(
        expect.objectContaining({ kind: 'success', message: 'Invite sent' }),
      );
    });
  });

  it('toggling the notifications switch off persists the change without prompting for permission', async () => {
    render(<SettingsScreen />);
    await waitFor(() => screen.getByText('Notifications'));

    const toggle = screen.getByRole('switch');
    fireEvent(toggle, 'valueChange', false);

    await waitFor(() => {
      expect(mockSetBudgetAlertsEnabled).toHaveBeenCalledWith('hh1', false);
    });
    expect(mockRequestNotificationPermission).not.toHaveBeenCalled();
  });

  it('tapping "Sign out" shows a confirm alert, and confirming calls signOut', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert');
    render(<SettingsScreen />);
    await waitFor(() => screen.getByText('Sign out'));

    fireEvent.press(screen.getByText('Sign out'));
    expect(alertSpy).toHaveBeenCalledWith(
      'Sign out?',
      expect.any(String),
      expect.arrayContaining([
        expect.objectContaining({ text: 'Cancel' }),
        expect.objectContaining({ text: 'Sign out' }),
      ]),
    );

    const buttons = alertSpy.mock.calls[0][2] as { text: string; onPress?: () => void }[];
    buttons.find((b) => b.text === 'Sign out')?.onPress?.();
    expect(mockSignOut).toHaveBeenCalled();
  });

  it('shows a leave-household confirm alert with more than one member, and confirming leaves', async () => {
    mockGetHouseholdMembers.mockResolvedValue([
      { uid: 'u1', email: 'jane@example.com', displayName: 'Jane Doe', role: 'owner', isYou: true },
      { uid: 'u2', email: 'bob@example.com', displayName: 'Bob', role: 'member', isYou: false },
    ]);
    const alertSpy = jest.spyOn(Alert, 'alert');
    render(<SettingsScreen />);

    await waitFor(() => {
      expect(screen.getByText('Leave household')).toBeTruthy();
    });
    fireEvent.press(screen.getByText('Leave household'));

    expect(alertSpy).toHaveBeenCalledWith(
      'Leave household?',
      expect.any(String),
      expect.arrayContaining([expect.objectContaining({ text: 'Leave' })]),
    );
    const buttons = alertSpy.mock.calls[0][2] as { text: string; onPress?: () => void }[];
    await act(async () => {
      buttons.find((b) => b.text === 'Leave')?.onPress?.();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(mockLeaveHousehold).toHaveBeenCalledWith(
        expect.objectContaining({ uid: 'u1', householdId: 'hh1' }),
      );
    });
  });
});
