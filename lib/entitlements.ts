import type Purchases from 'react-native-purchases';
import type { CustomerInfo, PurchasesOfferings, PurchasesPackage } from 'react-native-purchases';

/** RevenueCat entitlement identifier configured in the RC dashboard —
 *  gates AI-parse quota, PDF export, and multi-household. */
export const PREMIUM_ENTITLEMENT_ID = 'premium';

/** react-native-purchases is a native module — same defensive-load
 *  pattern as lib/expoContacts.ts / lib/cloudSync.ts's loadFirestore:
 *  an un-rebuilt binary (OTA-only update before the next native build)
 *  won't have it linked yet, so every call site has to no-op instead of
 *  crashing on a bare `import` at module scope. */
type PurchasesModule = typeof Purchases;

let cachedPurchases: PurchasesModule | null | undefined;

function loadPurchases(): PurchasesModule | null {
  if (cachedPurchases !== undefined) return cachedPurchases;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports, global-require
    cachedPurchases = require('react-native-purchases').default as PurchasesModule;
  } catch {
    cachedPurchases = null;
  }
  return cachedPurchases;
}

export function isEntitlementsAvailable(): boolean {
  return loadPurchases() !== null;
}

let configured = false;

/** Configures the SDK exactly once per process — call this before
 *  anything else here. `apiKey` is the platform-specific RevenueCat
 *  public SDK key (Android/iOS keys differ; see EXPO_PUBLIC_REVENUECAT_*
 *  in app.config.js `extra`). No-ops if the native module isn't linked
 *  or an empty key was passed (e.g. not configured for this platform). */
export function configurePurchases(apiKey: string | undefined): void {
  const Purchases = loadPurchases();
  if (!Purchases || configured || !apiKey) return;
  Purchases.configure({ apiKey });
  configured = true;
}

function isPremiumFromInfo(info: CustomerInfo): boolean {
  return info.entitlements.active[PREMIUM_ENTITLEMENT_ID] !== undefined;
}

/** Ties RevenueCat's subscriber identity to this app's own Firebase
 *  uid, so premium status follows the account across devices/reinstalls
 *  rather than staying anonymous-device-scoped. Call on sign-in. */
export async function loginPurchases(uid: string): Promise<boolean> {
  const Purchases = loadPurchases();
  if (!Purchases) return false;
  const { customerInfo } = await Purchases.logIn(uid);
  return isPremiumFromInfo(customerInfo);
}

/** Call on sign-out — otherwise the next signed-in-as-guest / different
 *  account on this device would inherit the previous user's RevenueCat
 *  identity. */
export async function logoutPurchases(): Promise<void> {
  const Purchases = loadPurchases();
  if (!Purchases) return;
  try {
    await Purchases.logOut();
  } catch {
    // logOut throws if the current user is already anonymous (e.g.
    // logoutPurchases called before any loginPurchases this session) —
    // that's already the state we want, not a real failure.
  }
}

export async function getIsPremium(): Promise<boolean> {
  const Purchases = loadPurchases();
  if (!Purchases) return false;
  const info = await Purchases.getCustomerInfo();
  return isPremiumFromInfo(info);
}

/** URL to the platform's own subscription-management page for this
 *  user — Play Store or App Store depending on where they subscribed.
 *  Null if there's no active subscription (nothing to manage) or the
 *  module isn't linked. */
export async function getManagementUrl(): Promise<string | null> {
  const Purchases = loadPurchases();
  if (!Purchases) return null;
  const info = await Purchases.getCustomerInfo();
  return info.managementURL;
}

export async function getOfferings(): Promise<PurchasesOfferings | null> {
  const Purchases = loadPurchases();
  if (!Purchases) return null;
  return await Purchases.getOfferings();
}

export type PurchaseOutcome =
  | { ok: true; isPremium: boolean }
  | { ok: false; userCancelled: boolean; message: string };

export async function purchasePackage(pkg: PurchasesPackage): Promise<PurchaseOutcome> {
  const Purchases = loadPurchases();
  if (!Purchases) return { ok: false, userCancelled: false, message: 'Purchases unavailable.' };
  try {
    const { customerInfo } = await Purchases.purchasePackage(pkg);
    return { ok: true, isPremium: isPremiumFromInfo(customerInfo) };
  } catch (e) {
    const err = e as { userCancelled?: boolean; message?: string };
    return {
      ok: false,
      userCancelled: err.userCancelled === true,
      message: err.message ?? 'Purchase failed.',
    };
  }
}

export async function restorePurchases(): Promise<boolean> {
  const Purchases = loadPurchases();
  if (!Purchases) return false;
  const info = await Purchases.restorePurchases();
  return isPremiumFromInfo(info);
}

/** Subscribes to live CustomerInfo changes (a purchase completing, a
 *  renewal, an externally-cancelled subscription) so UI stays in sync
 *  without polling. Returns a no-op unsubscribe if the module isn't
 *  linked, matching every other subscribe-style helper in this app. */
export function subscribeToEntitlementChanges(cb: (isPremium: boolean) => void): () => void {
  const Purchases = loadPurchases();
  if (!Purchases) return () => {};
  const listener = (info: CustomerInfo) => cb(isPremiumFromInfo(info));
  Purchases.addCustomerInfoUpdateListener(listener);
  return () => Purchases.removeCustomerInfoUpdateListener(listener);
}
