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
import { useAuth } from './AuthContext';

type EntitlementsState = {
  /** False until the first CustomerInfo read resolves (or the native
   *  module turns out not to be linked) — callers that gate on
   *  isPremium should wait for this rather than flashing a
   *  free-tier UI for a frame before the real value loads. */
  loading: boolean;
  isPremium: boolean;
  offerings: PurchasesOfferings | null;
  refreshOfferings: () => Promise<void>;
  purchasePackage: (pkg: PurchasesPackage) => Promise<PurchaseOutcome>;
  restorePurchases: () => Promise<boolean>;
};

const EntitlementsContext = createContext<EntitlementsState | null>(null);

export function EntitlementsProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [isPremium, setIsPremium] = useState(false);
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
    if (!isEntitlementsAvailable()) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const premium = user?.uid ? await loginPurchases(user.uid) : await getIsPremiumSafely();
        if (!cancelled) setIsPremium(premium);
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
  }, [user?.uid]);

  useEffect(() => {
    return subscribeToEntitlementChanges(setIsPremium);
  }, []);

  const refreshOfferings = useCallback(async () => {
    const next = await getOfferings();
    setOfferings(next);
  }, []);

  const purchasePackage = useCallback(async (pkg: PurchasesPackage): Promise<PurchaseOutcome> => {
    const outcome = await purchasePackageImpl(pkg);
    if (outcome.ok) setIsPremium(outcome.isPremium);
    return outcome;
  }, []);

  const restorePurchases = useCallback(async (): Promise<boolean> => {
    const premium = await restorePurchasesImpl();
    setIsPremium(premium);
    return premium;
  }, []);

  const value = useMemo<EntitlementsState>(
    () => ({ loading, isPremium, offerings, refreshOfferings, purchasePackage, restorePurchases }),
    [loading, isPremium, offerings, refreshOfferings, purchasePackage, restorePurchases],
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
