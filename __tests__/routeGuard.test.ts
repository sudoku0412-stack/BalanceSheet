import { pickTarget, targetToHref, RouteState } from '../lib/routeGuard';

const baseState: RouteState = {
  user: null,
  onboardingSeen: false,
};

describe('pickTarget — onboarding gate', () => {
  it('routes new users to onboarding', () => {
    expect(pickTarget(baseState)).toBe('onboarding');
  });

  it('keeps onboarding even if a user is somehow set (defensive)', () => {
    expect(pickTarget({ ...baseState, user: { uid: 'x' } })).toBe('onboarding');
  });
});

describe('pickTarget — auth gate', () => {
  it('routes onboarded users without a session to auth', () => {
    expect(pickTarget({ ...baseState, onboardingSeen: true })).toBe('auth');
  });

  it('treats undefined user as logged out', () => {
    const s = { ...baseState, onboardingSeen: true, user: undefined };
    expect(pickTarget(s)).toBe('auth');
  });
});

describe('pickTarget — signed-in gate', () => {
  it('routes onboarded, signed-in users straight to (tabs) — no verify/profile/biometric gates', () => {
    expect(
      pickTarget({ onboardingSeen: true, user: { uid: 'u1' } }),
    ).toBe('(tabs)');
  });

  it('onboarding always wins over auth', () => {
    expect(pickTarget({ onboardingSeen: false, user: { uid: 'u1' } })).toBe('onboarding');
  });

  it('auth always wins over (tabs) when signed out', () => {
    expect(pickTarget({ onboardingSeen: true, user: null })).toBe('auth');
  });
});

describe('targetToHref', () => {
  it('maps every target to a leading-slash route', () => {
    const targets = ['onboarding', 'auth', '(tabs)'] as const;
    for (const t of targets) {
      expect(targetToHref(t).startsWith('/')).toBe(true);
    }
  });

  it('produces stable hrefs that the router can replace to', () => {
    expect(targetToHref('onboarding')).toBe('/onboarding');
    expect(targetToHref('auth')).toBe('/auth');
    expect(targetToHref('(tabs)')).toBe('/(tabs)');
  });
});
