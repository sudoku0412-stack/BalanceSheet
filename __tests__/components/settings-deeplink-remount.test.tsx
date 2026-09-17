import React from 'react';
import { Pressable, Text } from 'react-native';
import { useRouter, Stack } from 'expo-router';
import { renderRouter, screen, waitFor, act, fireEvent, testRouter } from 'expo-router/testing-library';

// Targeted test for a suspected bug in the Home -> Settings deep-link:
// app/settings.tsx's scroll-to-budgets effect is `useEffect(..., [section])`.
// The worry is that if a user navigates Home -> Manage (pushes
// /settings?section=budgets) -> back -> Manage again, and expo-router
// REUSES the existing Settings screen instance instead of mounting a
// fresh one, then `section` is the same string both times and the
// effect (which only depends on that value) would never re-run on the
// second tap — so the second "Manage" tap would silently fail to scroll.
//
// This uses expo-router's OWN testing-library (real Stack navigator,
// real router.push/back — nothing about navigation is mocked) to
// answer the underlying factual question directly: does a push to the
// same href create a new component instance, or does it revive an
// existing one already in the stack?
//
// Unlike the other settings.test.tsx files, expo-router itself is
// intentionally NOT mocked here — that's the exact mechanism under test.

jest.mock('@expo/vector-icons', () => ({
  Ionicons: () => null,
}));

jest.mock('../../lib/AuthContext', () => ({
  useAuth: () => ({
    user: { uid: 'u1', email: 'jane@example.com', displayName: 'Jane Doe' },
    profile: { firstName: 'Jane', lastName: 'Doe', phone: null },
    signOut: jest.fn(),
    refreshProfile: jest.fn(async () => {}),
    setActiveHousehold: jest.fn(async () => {}),
  }),
}));

jest.mock('../../components/ui/Toast', () => ({
  useToast: () => ({ show: jest.fn(), dismiss: jest.fn() }),
}));

jest.mock('../../lib/EntitlementsContext', () => ({
  useEntitlements: () => ({
    loading: false,
    isPremium: false,
    offerings: null,
    refreshOfferings: jest.fn(),
    purchasePackage: jest.fn(),
    restorePurchases: jest.fn(),
  }),
}));

jest.mock('../../lib/entitlements', () => ({
  getManagementUrl: jest.fn(async () => null),
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

jest.mock('uuid', () => ({
  v4: () => 'mock-uuid',
}));

jest.mock('expo-file-system', () => ({
  documentDirectory: 'file:///mock/',
  EncodingType: { UTF8: 'utf8' },
  writeAsStringAsync: jest.fn(async () => {}),
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const RealSettingsScreen = require('../../app/settings').default;

let mountCount = 0;
/** Wraps the real SettingsScreen purely to count how many times a fresh
 * instance is actually mounted — the one fact this test needs that
 * isn't otherwise observable from outside the component. */
function InstrumentedSettingsScreen(props: Record<string, unknown> = {}) {
  React.useEffect(() => {
    mountCount += 1;
  }, []);
  return React.createElement(RealSettingsScreen, props);
}

function HomeStub() {
  const router = useRouter();
  return (
    <Pressable onPress={() => router.push('/settings?section=budgets')}>
      <Text>Manage</Text>
    </Pressable>
  );
}

function RootLayoutStub() {
  return <Stack />;
}

describe('Settings deep-link: does repeat navigation remount the screen?', () => {
  beforeEach(() => {
    mountCount = 0;
  });

  it('mounts a brand-new Settings instance on each push, even to the same href', async () => {
    renderRouter(
      {
        _layout: RootLayoutStub,
        index: HomeStub,
        settings: InstrumentedSettingsScreen,
      },
      { initialUrl: '/' },
    );

    // First "Manage" tap.
    await act(async () => {
      fireEvent.press(screen.getByText('Manage'));
    });
    await waitFor(() => {
      expect(screen.getByText('Sign out')).toBeTruthy();
    });
    expect(mountCount).toBe(1);

    // Back to Home.
    await act(async () => {
      testRouter.back();
    });
    await waitFor(() => {
      expect(screen.getByText('Manage')).toBeTruthy();
    });

    // Second "Manage" tap — pushes the exact same href
    // ('/settings?section=budgets') again.
    await act(async () => {
      fireEvent.press(screen.getByText('Manage'));
    });
    await waitFor(() => {
      expect(screen.getByText('Sign out')).toBeTruthy();
    });

    // If expo-router revived the existing (popped) Settings instance
    // instead of mounting a fresh one, mountCount would still be 1 and
    // the [section]-only effect would have had no reason to re-run —
    // which is exactly the failure mode the bug report worried about.
    // It's 2: `router.push` (a stack PUSH action) always adds a brand
    // new route/screen instance, never revives one already in history,
    // so the mount — and therefore the effect — genuinely happens again
    // on every tap regardless of whether `section`'s value repeats.
    expect(mountCount).toBe(2);
  });
});
