import React from 'react';
import { render, fireEvent, waitFor, screen } from '@testing-library/react-native';

// NOTE: mocks below build their jest.fn()s inline rather than closing
// over outer consts where the factory runs eagerly at first require
// (via ES import hoisting) — same convention as reports.test.tsx /
// households.test.tsx. References are recovered afterwards via the
// (now-mocked) module's exports.

const mockRouterBack = jest.fn();
const mockRouterPush = jest.fn();

jest.mock('expo-router', () => ({
  router: { back: (...args: unknown[]) => mockRouterBack(...args), push: (...args: unknown[]) => mockRouterPush(...args) },
}));

jest.mock('@expo/vector-icons', () => ({
  Ionicons: () => null,
}));

jest.mock('react-native-purchases', () => ({
  PACKAGE_TYPE: { ANNUAL: 'ANNUAL', MONTHLY: 'MONTHLY', UNKNOWN: 'UNKNOWN', CUSTOM: 'CUSTOM' },
}));

const mockToastShow = jest.fn();
jest.mock('../../components/ui/Toast', () => ({
  useToast: () => ({ show: mockToastShow, dismiss: jest.fn() }),
}));

let mockEntitlementsValue: any;
const mockRefreshOfferings = jest.fn(async () => {});
const mockPurchasePackage = jest.fn();
const mockRestorePurchases = jest.fn();
const mockRedeemCode = jest.fn();

jest.mock('../../lib/EntitlementsContext', () => ({
  useEntitlements: () => mockEntitlementsValue,
}));

import PaywallScreen from '../../app/paywall';

describe('PaywallScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockEntitlementsValue = {
      loading: false,
      isPremium: false,
      promoRedemption: null,
      redeemCode: mockRedeemCode,
      offerings: {
        current: {
          availablePackages: [
            { identifier: 'monthly', packageType: 'MONTHLY', product: { priceString: '$2.99', introPrice: { price: 0 } } },
            { identifier: 'annual', packageType: 'ANNUAL', product: { priceString: '$30.00', introPrice: { price: 0 } } },
          ],
        },
      },
      refreshOfferings: mockRefreshOfferings,
      purchasePackage: mockPurchasePackage,
      restorePurchases: mockRestorePurchases,
    };
  });

  it('renders both plans, annual first', async () => {
    render(<PaywallScreen />);
    await waitFor(() => {
      expect(screen.getByText('$30.00')).toBeTruthy();
    });
    expect(screen.getByText('$2.99')).toBeTruthy();
    expect(screen.getByText('BEST VALUE')).toBeTruthy();
  });

  it('redeeming a valid promo code shows nothing when it fails, and reports the reason', async () => {
    mockRedeemCode.mockResolvedValue({ ok: false, reason: "That code isn't valid." });
    render(<PaywallScreen />);
    await waitFor(() => screen.getByText('$30.00'));

    fireEvent.changeText(screen.getByPlaceholderText('Promo code'), 'WRONGCODE');
    fireEvent.press(screen.getByText('Apply'));

    await waitFor(() => {
      expect(mockRedeemCode).toHaveBeenCalledWith('WRONGCODE');
    });
    await waitFor(() => {
      expect(mockToastShow).toHaveBeenCalledWith({ kind: 'error', message: "That code isn't valid." });
    });
    expect(mockRouterBack).not.toHaveBeenCalled();
  });

  it('a successful FRIENDS2026 redemption flips isPremium and the effect navigates back', async () => {
    mockRedeemCode.mockImplementation(async (code: string) => {
      mockEntitlementsValue = { ...mockEntitlementsValue, isPremium: true, promoRedemption: { code, grantsPro: true, freeUntil: null } };
      return { ok: true, redemption: { code, grantsPro: true, freeUntil: null } };
    });
    const { rerender } = render(<PaywallScreen />);
    await waitFor(() => screen.getByText('$30.00'));

    fireEvent.changeText(screen.getByPlaceholderText('Promo code'), 'FRIENDS2026');
    fireEvent.press(screen.getByText('Apply'));

    await waitFor(() => {
      expect(mockRedeemCode).toHaveBeenCalledWith('FRIENDS2026');
    });
    // Re-render with the now-premium context value, same as a real
    // provider re-rendering its consumer after state updates.
    rerender(<PaywallScreen />);

    await waitFor(() => {
      expect(mockRouterBack).toHaveBeenCalled();
    });
  });
});
