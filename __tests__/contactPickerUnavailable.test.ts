jest.mock('react-native', () => ({ Platform: { OS: 'ios' } }));
jest.mock('expo-contacts', () => {
  throw new Error('not linked');
});

import { isContactPickerAvailable, pickContactWithPhone } from '../lib/contactPicker';

describe('contactPicker when expo-contacts is not linked', () => {
  it('isContactPickerAvailable returns false', () => {
    expect(isContactPickerAvailable()).toBe(false);
  });

  it('pickContactWithPhone resolves to null without throwing', async () => {
    await expect(pickContactWithPhone()).resolves.toBeNull();
  });
});
