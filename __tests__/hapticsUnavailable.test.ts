jest.mock('react-native', () => ({ NativeModules: {} }));

const mockImpactAsync = jest.fn();
const mockNotificationAsync = jest.fn();

jest.mock('expo-haptics', () => ({
  impactAsync: (...args: unknown[]) => mockImpactAsync(...args),
  notificationAsync: (...args: unknown[]) => mockNotificationAsync(...args),
  ImpactFeedbackStyle: { Light: 1, Medium: 2, Heavy: 3 },
  NotificationFeedbackType: { Success: 1, Warning: 2, Error: 3 },
}));

import {
  tapLight,
  tapMedium,
  tapHeavy,
  notifySuccess,
  notifyWarning,
  notifyError,
} from '../lib/haptics';

beforeEach(() => {
  jest.clearAllMocks();
});

describe('haptics when no native module key is present (not linked)', () => {
  it('every tap/notify function is a silent no-op', () => {
    tapLight();
    tapMedium();
    tapHeavy();
    notifySuccess();
    notifyWarning();
    notifyError();
    expect(mockImpactAsync).not.toHaveBeenCalled();
    expect(mockNotificationAsync).not.toHaveBeenCalled();
  });
});
