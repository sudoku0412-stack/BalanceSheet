import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Platform } from 'react-native';
import Constants from 'expo-constants';
import type { PurchasesOfferings, PurchasesPackage } from 'react-native-purchases';
import {
  configurePurchases,
  getIsPremium,
  getOfferings,
  isEntitlementsAvailable,
  loginPurchases,
  logoutPurchases,
  purchasePackage as purchasePackageImpl,
  restorePurchases as restorePurchasesImpl,
  subscribeToEntitlementChanges,
  type PurchaseOutcome,
} from './entitlements';
import { getActivePromoRedemption, redeemPromoCode, type PromoRedemption, type RedeemPromoCodeResult } from './promoCode';
import { useAuth } from './AuthContext';

type EntitlementsState = {
  /** False until the first CustomerInfo/promo read resolves (or the
   *  native module turns out not to be linked) — callers that gate on
   *  isPremium should wait for this rather than flashing a
   *  free-tier UI for a frame before the real value loads. */
  loading: boolean;
  /** True if EITHER a real subscription OR an active promo redemption
   *  (lib/promoCode.ts) grants access — callers never need to check
   *  the two sources separately. */
  isPremium: boolean;
  /** Non-null only when the current Premium access (if any) comes from
   *  a promo code rather than a real subscription — Settings uses this
   *  to show "Manage subscription" vs. just a status line, since
   *  there's nothing to manage on the App/Play Store for a promo grant. */
  promoRedemption: PromoRedemption | null;
  redeemCode: (code: string) => Promise<RedeemPromoCodeResult>;
  offerings: PurchasesOfferings | null;
  refreshOfferings: () => Promise<void>;
  purchasePackage: (pkg: PurchasesPackage) => Promise<PurchaseOutcome>;
  restorePurchases: () => Promise<boolean>;
};

const EntitlementsContext = createContext<EntitlementsState | null>(null);

function isPromoActive(redemption: PromoRedemption | null): boolean {
  if (!redemption) return false;
  if (redemption.grantsPro) return true;
  return redemption.freeUntil != null && redemption.freeUntil.getTime() > Date.now();
}

export function EntitlementsProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [subscriptionPremium, setSubscriptionPremium] = useState(false);
  const [promoRedemption, setPromoRedemption] = useState<PromoRedemption | null>(null);
  const [offerings, setOfferings] = useState<PurchasesOfferings | null>(null);
  const configuredRef = useRef(false);

  useEffect(() => {
    if (configuredRef.current) return;
    configuredRef.current = true;
    const extra = Constants.expoConfig?.extra as
      | { revenueCatApiKeyAndroid?: string; revenueCatApiKeyIos?: string }
      | undefined;
    const apiKey = Platform.OS === 'ios' ? extra?.revenueCatApiKeyIos : extra?.revenueCatApiKeyAndroid;
    configurePurchases(apiKey);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [premium, promo] = await Promise.all([
          isEntitlementsAvailable()
            ? user?.uid
              ? loginPurchases(user.uid)
              : getIsPremiumSafely()
            : Promise.resolve(false),
          user?.uid ? getActivePromoRedemption(user.uid) : Promise.resolve(null),
        ]);
        if (cancelled) return;
        setSubscriptionPremium(premium);
        setPromoRedemption(promo);
      } catch {
        // Best-effort — network hiccup or a not-yet-configured API key
        // shouldn't block app usage, it just means the free tier
        // applies until the next successful read.
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.uid]);

  // Sign-out needs its own effect (not folded into the one above) so it
  // fires on the null transition specifically, not on every uid change.
  useEffect(() => {
    if (user?.uid) return;
    void logoutPurchases();
    setPromoRedemption(null);
  }, [user?.uid]);

  useEffect(() => {
    return subscribeToEntitlementChanges(setSubscriptionPremium);
  }, []);

  const refreshOfferings = useCallback(async () => {
    const next = await getOfferings();
    setOfferings(next);
  }, []);

  const purchasePackage = useCallback(async (pkg: PurchasesPackage): Promise<PurchaseOutcome> => {
    const outcome = await purchasePackageImpl(pkg);
    if (outcome.ok) setSubscriptionPremium(outcome.isPremium);
    return outcome;
  }, []);

  const restorePurchases = useCallback(async (): Promise<boolean> => {
    const premium = await restorePurchasesImpl();
    setSubscriptionPremium(premium);
    return premium;
  }, []);

  const redeemCode = useCallback(
    async (code: string): Promise<RedeemPromoCodeResult> => {
      if (!user?.uid) return { ok: false, reason: 'Sign in first.' };
      const result = await redeemPromoCode(code, user.uid);
      if (result.ok) setPromoRedemption(result.redemption);
      return result;
    },
    [user?.uid],
  );

  const isPremium = subscriptionPremium || isPromoActive(promoRedemption);

  const value = useMemo<EntitlementsState>(
    () => ({
      loading,
      isPremium,
      promoRedemption: isPromoActive(promoRedemption) ? promoRedemption : null,
      redeemCode,
      offerings,
      refreshOfferings,
      purchasePackage,
      restorePurchases,
    }),
    [loading, isPremium, promoRedemption, redeemCode, offerings, refreshOfferings, purchasePackage, restorePurchases],
  );

  return <EntitlementsContext.Provider value={value}>{children}</EntitlementsContext.Provider>;
}

async function getIsPremiumSafely(): Promise<boolean> {
  try {
    return await getIsPremium();
  } catch {
    return false;
  }
}

export function useEntitlements(): EntitlementsState {
  const ctx = useContext(EntitlementsContext);
  if (!ctx) throw new Error('useEntitlements must be used inside EntitlementsProvider');
  return ctx;
}
