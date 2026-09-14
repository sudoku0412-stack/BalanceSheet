import React from 'react';
import { render, fireEvent, waitFor, screen, act } from '@testing-library/react-native';

// Targeted test for a race in app/settings.tsx: the deep-linked "scroll
// to Categories & budgets" effect fires a hardcoded 150ms after mount
// and reads `budgetsSectionY.current` (last value written by the
// Section's onLayout) at that moment. `loadMembers()` is an async
// Firestore call kicked off in a separate effect; if it resolves AFTER
// the 150ms timer and the household has >1 member, the "Household"
// section (which sits ABOVE "Categories & budgets" in scroll order)
// grows a "Leave household" row, pushing Categories & budgets down.
//
// The effect depends on [section, members] and only latches
// `didAutoScrollRef` (stopping further auto-scrolls) once `members` has
// resolved at least once, so a late-resolving members load re-schedules
// a second, corrective scroll instead of leaving the first, stale one
// as final — first test proves that self-correction; second test
// covers the already-correct case where members resolves early.
//
// This test controls both the timer and the loadMembers promise
// deterministically (fake timers + a manually-resolved deferred) so we
// can force the exact interleaving and prove the self-correction.

const mockToastShow = jest.fn();

jest.mock('expo-router', () => ({
  useRouter: () => ({ back: jest.fn(), push: jest.fn(), replace: jest.fn() }),
  useLocalSearchParams: () => ({ section: 'budgets' }),
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
    signOut: jest.fn(),
    refreshProfile: jest.fn(async () => {}),
    setActiveHousehold: jest.fn(async () => {}),
  }),
}));

jest.mock('../../components/ui/Toast', () => ({
  useToast: () => ({ show: mockToastShow, dismiss: jest.fn() }),
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

// getHouseholdMembers is the async Firestore call whose resolution timing
// relative to the 300ms scroll timer is exactly what's under test —
// controlled per-test via a deferred promise below, NOT a fixed mock here.
const mockGetHouseholdMembers = jest.fn();
jest.mock('../../lib/cloudSync', () => ({
  getHouseholdMembers: (...args: unknown[]) => mockGetHouseholdMembers(...args),
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

// Replace ScrollView with a ref-forwarding stand-in that records every
// imperative scrollTo call — the production code drives ScrollView only
// through `scrollRef.current?.scrollTo(...)`, never through props, so
// this is a faithful substitute and the only way to observe the call
// under the RN test renderer (which never runs a real layout engine).
const mockScrollTo = jest.fn();
jest.mock('react-native', () => {
  // Mutate the real module's export in place (rather than spreading it
  // into a new object) — a spread would eagerly evaluate every lazy
  // getter on the RN module (FlatList, DevMenu, etc.), which blows up
  // outside the native runtime. Overriding just the one property
  // preserves every other export's normal lazy resolution.
  const RN = jest.requireActual('react-native');
  const ReactActual = jest.requireActual('react');
  const MockScrollView = ReactActual.forwardRef((props: any, ref: any) => {
    ReactActual.useImperativeHandle(ref, () => ({ scrollTo: mockScrollTo }));
    return ReactActual.createElement(RN.View, props, props.children);
  });
  Object.defineProperty(RN, 'ScrollView', { value: MockScrollView, configurable: true });
  return RN;
});

import SettingsScreen from '../../app/settings';

describe('SettingsScreen budgets deep-link scroll vs. household-load race', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it(
    'self-corrects to the post-growth Y when getHouseholdMembers resolves ' +
      'after the first deep-link timer fires',
    async () => {
      // Deferred promise: getHouseholdMembers() is pending until the test
      // explicitly resolves it, so we can place its resolution AFTER the
      // 300ms timer fires — reproducing "slow Firestore round-trip".
      let resolveMembers!: (members: unknown[]) => void;
      mockGetHouseholdMembers.mockReturnValue(
        new Promise((resolve) => {
          resolveMembers = resolve;
        }),
      );

      render(<SettingsScreen />);

      // Let the initial mount settle (useFocusEffect's async body, the
      // loadMembers() call kicked off, etc.) without advancing the
      // 300ms scroll timer yet.
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });

      // Simulate the FIRST layout pass — household still unloaded, so
      // only the solo "you" row renders and Categories & budgets sits
      // at this (small) Y.
      const sectionTitle = screen.getByText('Categories & budgets');
      fireEvent(sectionTitle.parent!, 'layout', {
        nativeEvent: { layout: { y: 1000, x: 0, width: 300, height: 40 } },
      });

      // Fire the hardcoded 300ms deep-link timer BEFORE getHouseholdMembers
      // resolves — this is the exact race: the timer captures whatever
      // budgetsSectionY.current holds right now (1000).
      await act(async () => {
        jest.advanceTimersByTime(300);
      });

      expect(mockScrollTo).toHaveBeenCalledTimes(1);
      expect(mockScrollTo).toHaveBeenCalledWith({ y: 1000, animated: true });

      // NOW the slow Firestore call finally resolves with a multi-member
      // household — in the real app this renders the extra "Leave
      // household" row and pushes Categories & budgets further down.
      await act(async () => {
        resolveMembers([
          { uid: 'u1', email: 'jane@example.com', displayName: 'Jane Doe', role: 'owner', isYou: true },
          { uid: 'u2', email: 'bob@example.com', displayName: 'Bob', role: 'member', isYou: false },
        ]);
        await Promise.resolve();
      });

      // Confirm the household did grow (the leave-household row now
      // exists) — i.e. the layout genuinely would shift in a real device.
      await waitFor(() => {
        expect(screen.getByText('Leave household')).toBeTruthy();
      });

      // Simulate the SECOND, post-growth layout pass with the new,
      // larger Y that a real device would report once Household grew.
      const sectionTitleAfter = screen.getByText('Categories & budgets');
      fireEvent(sectionTitleAfter.parent!, 'layout', {
        nativeEvent: { layout: { y: 1300, x: 0, width: 300, height: 40 } },
      });

      // The effect depends on [section, members] and only latches
      // `didAutoScrollRef` once `members` has resolved at least once —
      // so `members` changing (null -> array) here re-schedules a
      // second timer rather than leaving the stale first scroll as
      // final. Advancing past it proves the self-correction.
      await act(async () => {
        jest.advanceTimersByTime(150);
      });

      expect(mockScrollTo).toHaveBeenCalledTimes(2);
      expect(mockScrollTo).toHaveBeenNthCalledWith(1, { y: 1000, animated: true });
      expect(mockScrollTo).toHaveBeenNthCalledWith(2, { y: 1300, animated: true });
    },
  );

  it(
    'scrolls to the correct, post-growth Y when getHouseholdMembers resolves ' +
      'BEFORE the 300ms timer fires (the non-buggy ordering, for contrast)',
    async () => {
      let resolveMembers!: (members: unknown[]) => void;
      mockGetHouseholdMembers.mockReturnValue(
        new Promise((resolve) => {
          resolveMembers = resolve;
        }),
      );

      render(<SettingsScreen />);

      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });

      const sectionTitle = screen.getByText('Categories & budgets');
      fireEvent(sectionTitle.parent!, 'layout', {
        nativeEvent: { layout: { y: 1000, x: 0, width: 300, height: 40 } },
      });

      // This time, members load and the layout grows BEFORE the 300ms
      // timer elapses.
      await act(async () => {
        resolveMembers([
          { uid: 'u1', email: 'jane@example.com', displayName: 'Jane Doe', role: 'owner', isYou: true },
          { uid: 'u2', email: 'bob@example.com', displayName: 'Bob', role: 'member', isYou: false },
        ]);
        await Promise.resolve();
      });
      await waitFor(() => {
        expect(screen.getByText('Leave household')).toBeTruthy();
      });

      const sectionTitleAfter = screen.getByText('Categories & budgets');
      fireEvent(sectionTitleAfter.parent!, 'layout', {
        nativeEvent: { layout: { y: 1300, x: 0, width: 300, height: 40 } },
      });

      await act(async () => {
        jest.advanceTimersByTime(300);
      });

      // Because the ref is read at fire-time (not captured at effect
      // creation), the timer now picks up the updated Y — this ordering
      // is NOT buggy.
      expect(mockScrollTo).toHaveBeenCalledTimes(1);
      expect(mockScrollTo).toHaveBeenCalledWith({ y: 1300, animated: true });
    },
  );
});
