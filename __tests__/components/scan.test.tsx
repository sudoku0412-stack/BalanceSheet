import React from 'react';
import { render, waitFor, screen, fireEvent, act } from '@testing-library/react-native';
import { Platform, Switch, TouchableOpacity } from 'react-native';

// This screen (app/(tabs)/scan.tsx, 2277 lines) is camera/OCR/AI-parsing
// heavy — expo-camera, expo-image-picker, an on-device ML Kit text
// recognizer, and two different cloud receipt-parsing backends (Gemini +
// a Cloudflare Worker fallback). None of those can run in jest (no real
// camera hardware, no network). Full interaction coverage (actually
// capturing/parsing a receipt) is out of scope here — this is a smoke
// test: mock every native/IO dependency so the module can be imported and
// rendered at all, then assert the baseline camera-idle UI shows up
// without throwing, plus the one clean, easily-isolated interaction
// available without any of that machinery: tapping the manual-entry
// affordance switches the screen into the manual-entry form.
//
// NOTE: mocks below that return plain object literals build their
// jest.fn()s inline rather than closing over outer consts — those
// factories run eagerly at first require, which (via ES import hoisting)
// can happen before an outer `const mock... = jest.fn()` in this file is
// actually assigned.

jest.mock('expo-camera', () => ({
  CameraView: () => null,
  useCameraPermissions: () => [{ granted: false, canAskAgain: true }, jest.fn()],
}));

jest.mock('expo-image-picker', () => ({
  launchImageLibraryAsync: jest.fn(),
  MediaTypeOptions: { Images: 'Images' },
}));

jest.mock('expo-constants', () => ({
  expoConfig: { extra: {} },
}));

jest.mock('expo-file-system', () => ({
  documentDirectory: 'file:///mock/',
  EncodingType: { UTF8: 'utf8' },
  writeAsStringAsync: jest.fn(async () => {}),
  copyAsync: jest.fn(async () => {}),
  getInfoAsync: jest.fn(async () => ({ exists: true })),
}));

jest.mock('@react-native-ml-kit/text-recognition', () => ({
  default: { recognize: jest.fn(async () => ({ text: '' })) },
}));

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), back: jest.fn(), replace: jest.fn() }),
  useLocalSearchParams: () => ({}),
  useFocusEffect: (cb: () => void) => {
    require('react').useEffect(cb, []);
  },
}));

jest.mock('@expo/vector-icons', () => ({
  Ionicons: () => null,
}));

jest.mock('../../lib/database', () => ({
  saveReceipt: jest.fn(),
  saveCorrection: jest.fn(),
  getRelevantCorrections: jest.fn(async () => []),
  getGeminiCachedResponse: jest.fn(async () => null),
  setGeminiCachedResponse: jest.fn(async () => {}),
  getCurrentHouseholdId: jest.fn(() => 'hh1'),
  getReceiptsByMonth: jest.fn(async () => []),
}));

jest.mock('../../lib/cloudSync', () => ({
  getHouseholdMembers: jest.fn(async () => []),
}));

jest.mock('../../lib/AuthContext', () => ({
  useAuth: () => ({
    user: { uid: 'u1' },
    profile: { firstName: 'Jane', lastName: 'Doe' },
    setEditInProgress: jest.fn(),
  }),
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

jest.mock('../../lib/receiptPhoto', () => ({
  persistReceiptImage: jest.fn(async (uri: string) => uri),
}));

jest.mock('../../lib/haptics', () => ({
  notifySuccess: jest.fn(),
}));

jest.mock('../../lib/notifications', () => ({
  notifyHouseholdOfBudgetStatus: jest.fn(),
  notifyNewExpenseToHousehold: jest.fn(),
  notifyNewSharedExpense: jest.fn(),
}));

jest.mock('../../lib/geminiParseReceipt', () => ({
  parseReceiptWithGemini: jest.fn(),
  parseGeminiPayload: jest.fn(),
}));

jest.mock('../../lib/cloudflareReceiptParse', () => ({
  parseReceiptWithCloudflare: jest.fn(),
}));

jest.mock('../../lib/secureStorage', () => ({
  getGeminiApiKey: jest.fn(async () => null),
  getCurrency: jest.fn(async () => 'USD'),
}));

jest.mock('uuid', () => ({
  v4: () => 'mock-uuid',
}));

import ScanScreen from '../../app/(tabs)/scan';

describe('ScanScreen (smoke test)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders the camera-idle screen without throwing, given a mocked signed-in user', async () => {
    render(<ScanScreen />);
    await waitFor(() => {
      expect(screen.getByText('Align receipt within frame')).toBeTruthy();
    });
  });

  // The "Repeat this expense" Switch's thumbColor branches on
  // Platform.OS (see app/(tabs)/scan.tsx: `Platform.OS === 'android' ?
  // '#fff' : undefined`) — undefined on iOS lets the native default
  // thumb render, '#fff' on Android matches the accent track. This is
  // the one Platform.OS branch this screen's restyle touched; assert
  // both branches still resolve to the right value and render without
  // throwing, on the manual-entry form where that Switch lives.
  describe('the recurring-toggle Switch thumbColor Platform.OS branch', () => {
    const originalOS = Platform.OS;

    afterEach(() => {
      Platform.OS = originalOS;
    });

    async function renderManualEntryWithRecurringToggle() {
      render(<ScanScreen />);
      await waitFor(() => {
        expect(screen.getByText('Align receipt within frame')).toBeTruthy();
      });

      // The manual-entry entry point is the icon-only side action in the
      // idle camera screen's shutter row (onPress={startManualEntry}); it
      // has no visible label since its Ionicons glyph is mocked to null,
      // so it's located by the onPress handler's function identity
      // rather than by a brittle position/count assumption.
      const manualEntryButton = screen
        .UNSAFE_getAllByType(TouchableOpacity)
        .find((el) => el.props.onPress?.name === 'startManualEntry');
      expect(manualEntryButton).toBeTruthy();
      await act(async () => {
        fireEvent.press(manualEntryButton!);
      });

      await waitFor(() => {
        expect(screen.getByText('Repeat this expense')).toBeTruthy();
      });
    }

    it("resolves to '#fff' on android", async () => {
      Platform.OS = 'android';
      await renderManualEntryWithRecurringToggle();

      // react-native's own Switch is a forwardRef wrapping a
      // platform-specific native host component, so the accessibility
      // tree can surface more than one "ForwardRef(Switch)" instance
      // for the same on-screen toggle — every one of them carries the
      // same props, so asserting on all of them (rather than picking
      // just one) is both safe and exhaustive.
      const toggles = screen.UNSAFE_getAllByType(Switch);
      expect(toggles.length).toBeGreaterThan(0);
      toggles.forEach((toggle) => expect(toggle.props.thumbColor).toBe('#fff'));
    });

    it('resolves to undefined (native default) on ios', async () => {
      Platform.OS = 'ios';
      await renderManualEntryWithRecurringToggle();

      const toggles = screen.UNSAFE_getAllByType(Switch);
      expect(toggles.length).toBeGreaterThan(0);
      toggles.forEach((toggle) => expect(toggle.props.thumbColor).toBeUndefined());
    });
  });
});
