jest.mock('react-native', () => ({ NativeModules: { ExpoHaptics: {} } }));

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
  mockImpactAsync.mockResolvedValue(undefined);
  mockNotificationAsync.mockResolvedValue(undefined);
});

describe('haptics when native module is available', () => {
  it('tapLight calls impactAsync with Light style', () => {
    tapLight();
    expect(mockImpactAsync).toHaveBeenCalledWith(1);
  });

  it('tapMedium calls impactAsync with Medium style', () => {
    tapMedium();
    expect(mockImpactAsync).toHaveBeenCalledWith(2);
  });

  it('tapHeavy calls impactAsync with Heavy style', () => {
    tapHeavy();
    expect(mockImpactAsync).toHaveBeenCalledWith(3);
  });

  it('notifySuccess calls notificationAsync with Success type', () => {
    notifySuccess();
    expect(mockNotificationAsync).toHaveBeenCalledWith(1);
  });

  it('notifyWarning calls notificationAsync with Warning type', () => {
    notifyWarning();
    expect(mockNotificationAsync).toHaveBeenCalledWith(2);
  });

  it('notifyError calls notificationAsync with Error type', () => {
    notifyError();
    expect(mockNotificationAsync).toHaveBeenCalledWith(3);
  });

  it('a rejected promise from the native call never throws or bubbles', async () => {
    mockImpactAsync.mockRejectedValue(new Error('native bridge error'));
    expect(() => tapLight()).not.toThrow();
    // let the swallowed rejection's microtask flush
    await Promise.resolve();
    await Promise.resolve();
  });
});
