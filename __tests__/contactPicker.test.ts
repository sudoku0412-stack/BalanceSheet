jest.mock('react-native', () => ({ Platform: { OS: 'ios' } }));

const mockRequestPermissionsAsync = jest.fn();
const mockPresentContactPickerAsync = jest.fn();

jest.mock('expo-contacts', () => ({
  requestPermissionsAsync: (...args: unknown[]) => mockRequestPermissionsAsync(...args),
  presentContactPickerAsync: (...args: unknown[]) => mockPresentContactPickerAsync(...args),
}));

import { Platform } from 'react-native';
import { isContactPickerAvailable, pickContactWithPhone } from '../lib/contactPicker';

beforeEach(() => {
  jest.clearAllMocks();
  (Platform as unknown as { OS: string }).OS = 'ios';
});

describe('isContactPickerAvailable', () => {
  it('true when expo-contacts is linked', () => {
    expect(isContactPickerAvailable()).toBe(true);
  });
});

describe('pickContactWithPhone', () => {
  it('on iOS, skips the permission check and opens the picker directly', async () => {
    mockPresentContactPickerAsync.mockResolvedValue({
      name: 'Jane Doe',
      phoneNumbers: [{ number: '+1 (416) 555-1234' }],
    });
    const result = await pickContactWithPhone();
    expect(mockRequestPermissionsAsync).not.toHaveBeenCalled();
    expect(result).toEqual({ name: 'Jane Doe', phoneE164: '+14165551234' });
  });

  it('on Android, returns null when permission is denied', async () => {
    (Platform as unknown as { OS: string }).OS = 'android';
    mockRequestPermissionsAsync.mockResolvedValue({ status: 'denied' });
    const result = await pickContactWithPhone();
    expect(result).toBeNull();
    expect(mockPresentContactPickerAsync).not.toHaveBeenCalled();
  });

  it('on Android, opens the picker once permission is granted', async () => {
    (Platform as unknown as { OS: string }).OS = 'android';
    mockRequestPermissionsAsync.mockResolvedValue({ status: 'granted' });
    mockPresentContactPickerAsync.mockResolvedValue({
      name: 'Bob',
      phoneNumbers: [{ number: '+1 416 555 1234' }],
    });
    const result = await pickContactWithPhone();
    expect(result).toEqual({ name: 'Bob', phoneE164: '+14165551234' });
  });

  it('returns null when the user cancels the picker', async () => {
    mockPresentContactPickerAsync.mockResolvedValue(null);
    const result = await pickContactWithPhone();
    expect(result).toBeNull();
  });

  it('returns null when the picked contact has no phone number', async () => {
    mockPresentContactPickerAsync.mockResolvedValue({ name: 'No Phone', phoneNumbers: [] });
    const result = await pickContactWithPhone();
    expect(result).toBeNull();
  });

  it('returns null when the phone number cannot be normalized', async () => {
    mockPresentContactPickerAsync.mockResolvedValue({
      name: 'Bad Number',
      phoneNumbers: [{ number: '123' }],
    });
    const result = await pickContactWithPhone();
    expect(result).toBeNull();
  });

  it('falls back to "Contact" when the picked contact has no name', async () => {
    mockPresentContactPickerAsync.mockResolvedValue({
      name: '',
      phoneNumbers: [{ number: '+14165551234' }],
    });
    const result = await pickContactWithPhone();
    expect(result?.name).toBe('Contact');
  });
});
