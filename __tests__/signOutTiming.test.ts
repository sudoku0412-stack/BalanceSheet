jest.mock('react-native', () => ({ Platform: { OS: 'ios' } }));

import { IOS_ALERT_SETTLE_MS, NATIVE_SIGNOUT_DEFER_MS } from '../lib/signOutTiming';

describe('signOutTiming', () => {
  it('waits 500ms after the confirm alert before mutating auth', () => {
    expect(IOS_ALERT_SETTLE_MS).toBe(500);
  });

  it('defers native GIDSignIn / Firebase / RevenueCat sign-out on iOS', () => {
    expect(NATIVE_SIGNOUT_DEFER_MS).toBe(700);
  });

  it('does not defer native sign-out on Android', () => {
    jest.resetModules();
    jest.doMock('react-native', () => ({ Platform: { OS: 'android' } }));
    const { NATIVE_SIGNOUT_DEFER_MS: androidDefer } = require('../lib/signOutTiming');
    expect(androidDefer).toBe(0);
  });
});
