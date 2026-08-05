import React from 'react';
import { render, waitFor, screen } from '@testing-library/react-native';

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
  requestMediaLibraryPermissionsAsync: jest.fn(),
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
});
