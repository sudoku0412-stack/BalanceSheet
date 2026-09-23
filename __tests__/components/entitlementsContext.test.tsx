import React from 'react';
import { Text } from 'react-native';
import { render, waitFor, screen } from '@testing-library/react-native';

// NOTE: mocks below build their jest.fn()s inline rather than closing
// over outer consts — same convention as households.test.tsx /
// settings.test.tsx: factories run eagerly at first require (via ES
// import hoisting), before an outer `const mock... = jest.fn()` in this
// file would be assigned. References are recovered via the (now-mocked)
// module's exports and reconfigured per-test in beforeEach.

jest.mock('expo-constants', () => ({
  get expoConfig() {
    return { extra: {} };
  },
}));

let mockAuthValue: any;
jest.mock('../../lib/AuthContext', () => ({
  useAuth: () => mockAuthValue,
}));

jest.mock('../../lib/entitlements', () => ({
  configurePurchases: jest.fn(),
  getIsPremium: jest.fn(async () => false),
  getOfferings: jest.fn(async () => null),
  isEntitlementsAvailable: jest.fn(() => true),
  loginPurchases: jest.fn(async () => false),
  logoutPurchases: jest.fn(async () => {}),
  purchasePackage: jest.fn(),
  restorePurchases: jest.fn(),
  subscribeToEntitlementChanges: jest.fn(() => () => {}),
}));

jest.mock('../../lib/promoCode', () => ({
  getActivePromoRedemption: jest.fn(async () => null),
  redeemPromoCode: jest.fn(),
}));

import { EntitlementsProvider, useEntitlements } from '../../lib/EntitlementsContext';
import { loginPurchases, logoutPurchases } from '../../lib/entitlements';
import { getActivePromoRedemption } from '../../lib/promoCode';

const mockLoginPurchases = loginPurchases as jest.Mock;
const mockLogoutPurchases = logoutPurchases as jest.Mock;
const mockGetActivePromoRedemption = getActivePromoRedemption as jest.Mock;

/** Renders the state useEntitlements() exposes as plain text so tests
 *  can assert on it with screen.getByText/queryByText once the
 *  Provider's async bootstrap effect has settled. */
function Consumer() {
  const { loading, isPremium, promoRedemption } = useEntitlements();
  return (
    <>
      <Text testID="loading">{String(loading)}</Text>
      <Text testID="isPremium">{String(isPremium)}</Text>
      <Text testID="promoCode">{promoRedemption?.code ?? 'none'}</Text>
    </>
  );
}

function renderWithProvider() {
  return render(
    <EntitlementsProvider>
      <Consumer />
    </EntitlementsProvider>,
  );
}

async function waitForLoaded() {
  await waitFor(() => expect(screen.getByTestId('loading').props.children).toBe('false'));
}

describe('EntitlementsProvider premium/promo composition', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAuthValue = { user: { uid: 'u1' } };
    mockLoginPurchases.mockResolvedValue(false);
    mockGetActivePromoRedemption.mockResolvedValue(null);
  });

  it('grants Premium from a real subscription with no promo active', async () => {
    mockLoginPurchases.mockResolvedValue(true);
    renderWithProvider();
    await waitForLoaded();

    expect(screen.getByTestId('isPremium').props.children).toBe('true');
    expect(screen.getByTestId('promoCode').props.children).toBe('none');
  });

  it('grants Premium from a permanent (grantsPro) promo redemption with no subscription', async () => {
    mockLoginPurchases.mockResolvedValue(false);
    mockGetActivePromoRedemption.mockResolvedValue({ code: 'FRIENDS2026', grantsPro: true, freeUntil: null });
    renderWithProvider();
    await waitForLoaded();

    expect(screen.getByTestId('isPremium').props.children).toBe('true');
    expect(screen.getByTestId('promoCode').props.children).toBe('FRIENDS2026');
  });

  it('grants Premium from a time-limited promo whose freeUntil is still in the future', async () => {
    const future = new Date(Date.now() + 24 * 60 * 60 * 1000);
    mockGetActivePromoRedemption.mockResolvedValue({ code: 'WELCOME30', grantsPro: false, freeUntil: future });
    renderWithProvider();
    await waitForLoaded();

    expect(screen.getByTestId('isPremium').props.children).toBe('true');
    expect(screen.getByTestId('promoCode').props.children).toBe('WELCOME30');
  });

  /**
   * Defense-in-depth check: lib/promoCode.ts's getActivePromoRedemption
   * already filters out expired freeDays grants server-side, but
   * EntitlementsContext's own isPromoActive() re-checks freeUntil
   * against Date.now() before trusting whatever redemption object it
   * was handed. If that second check were ever removed (or a future
   * caller fed it a stale cached redemption), a lapsed discount code
   * would silently keep unlocking Premium and hiding the "expired"
   * promo status. This proves the guard is actually load-bearing by
   * simulating exactly that: a mocked "backend" response that (unlike
   * the real getActivePromoRedemption) returns an already-expired
   * freeUntil anyway.
   */
  it('does not grant Premium (or expose the redemption) for an already-expired freeUntil', async () => {
    const past = new Date(Date.now() - 24 * 60 * 60 * 1000);
    mockGetActivePromoRedemption.mockResolvedValue({ code: 'STALE30', grantsPro: false, freeUntil: past });
    renderWithProvider();
    await waitForLoaded();

    expect(screen.getByTestId('isPremium').props.children).toBe('false');
    expect(screen.getByTestId('promoCode').props.children).toBe('none');
  });

  it('logs out of RevenueCat and clears any promo redemption once the user signs out', async () => {
    mockGetActivePromoRedemption.mockResolvedValue({ code: 'FRIENDS2026', grantsPro: true, freeUntil: null });
    const utils = renderWithProvider();
    await waitForLoaded();
    expect(screen.getByTestId('promoCode').props.children).toBe('FRIENDS2026');

    mockAuthValue = { user: null };
    utils.rerender(
      <EntitlementsProvider>
        <Consumer />
      </EntitlementsProvider>,
    );

    await waitFor(() => expect(mockLogoutPurchases).toHaveBeenCalled());
    expect(screen.getByTestId('promoCode').props.children).toBe('none');
  });
});
