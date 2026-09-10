import type FirestoreModuleType from '@react-native-firebase/firestore';

/** Same defensive-load pattern as lib/cloudSync.ts's loadFirestore —
 *  duplicated locally rather than imported, since cloudSync.ts doesn't
 *  export its copy and this module has no other reason to depend on
 *  cloudSync.ts. */
type FirestoreModule = typeof FirestoreModuleType;
let cachedFirestore: FirestoreModule | null | undefined;

function loadFirestore(): FirestoreModule | null {
  if (cachedFirestore !== undefined) return cachedFirestore as FirestoreModule | null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports, global-require
    const mod = require('@react-native-firebase/firestore').default;
    cachedFirestore = typeof mod === 'function' ? mod : null;
  } catch {
    cachedFirestore = null;
  }
  return cachedFirestore as FirestoreModule | null;
}

export type PromoRedemption = {
  code: string;
  grantsPro: boolean;
  /** Non-null only for a time-limited discount code — null means
   *  "grantsPro forever" (FRIENDS2026-style) or "not a free-access
   *  code at all" depending on grantsPro. */
  freeUntil: Date | null;
};

export type RedeemPromoCodeResult =
  | { ok: true; redemption: PromoRedemption }
  | { ok: false; reason: string };

/**
 * Redeems a promo/discount code for the signed-in user. Codes are
 * admin-managed docs at promoCodes/{CODE} (seeded by hand in the
 * Firebase console — no backend to run a proper admin tool against,
 * see firestore.rules) with shape { active: boolean, grantsPro:
 * boolean, freeDays: number | null }. FRIENDS2026 (grantsPro: true,
 * freeDays: null) is the permanent full-access code; freeDays > 0
 * grants Premium for that many days instead — see
 * lib/EntitlementsContext.tsx for how this combines with a real
 * subscription.
 *
 * One redemption per account, ever — promoRedemptions/{uid} is a
 * create-only doc (firestore.rules denies update/delete), so a second
 * attempt fails with a permission error, translated below into a
 * normal "already redeemed" result rather than throwing.
 */
export async function redeemPromoCode(code: string, uid: string): Promise<RedeemPromoCodeResult> {
  const firestore = loadFirestore();
  if (!firestore) return { ok: false, reason: 'Promo codes need a newer build of the app.' };

  const normalized = code.trim().toUpperCase();
  if (!normalized) return { ok: false, reason: 'Enter a code first.' };

  const db = firestore();
  try {
    const codeSnap = await db.collection('promoCodes').doc(normalized).get();
    if (!codeSnap.exists) return { ok: false, reason: "That code isn't valid." };
    const data = codeSnap.data() ?? {};
    if (data.active !== true) return { ok: false, reason: 'That code has expired.' };

    const grantsPro = data.grantsPro === true;
    const freeDays = typeof data.freeDays === 'number' && data.freeDays > 0 ? data.freeDays : null;
    if (!grantsPro && !freeDays) {
      return { ok: false, reason: "That code isn't valid." };
    }
    const freeUntil = grantsPro ? null : new Date(Date.now() + freeDays! * 24 * 60 * 60 * 1000);

    await db.collection('promoRedemptions').doc(uid).set({
      uid,
      code: normalized,
      grantsPro,
      freeUntil: freeUntil ? firestore.Timestamp.fromDate(freeUntil) : null,
      redeemedAt: firestore.FieldValue.serverTimestamp(),
    });

    return { ok: true, redemption: { code: normalized, grantsPro, freeUntil } };
  } catch (e) {
    const err = e as { code?: string; message?: string };
    if (err.code === 'firestore/permission-denied') {
      // Either the create-only rule rejected a second redemption
      // attempt (doc already exists) or the code went inactive between
      // the read above and the write — both look identical from here,
      // and "already redeemed" is the far more common real cause.
      return { ok: false, reason: "You've already redeemed a promo code on this account." };
    }
    return { ok: false, reason: err.message ?? "Couldn't redeem that code." };
  }
}

/** Reads back this user's own redemption (if any), resolving a
 *  time-limited grant against the current time — a freeDays code
 *  that's already elapsed reports as no active redemption at all,
 *  same shape as never having redeemed one. */
export async function getActivePromoRedemption(uid: string): Promise<PromoRedemption | null> {
  const firestore = loadFirestore();
  if (!firestore) return null;
  try {
    const snap = await firestore().collection('promoRedemptions').doc(uid).get();
    if (!snap.exists) return null;
    const data = snap.data() ?? {};
    const grantsPro = data.grantsPro === true;
    const freeUntilRaw = data.freeUntil as { toDate(): Date } | null | undefined;
    const freeUntil = freeUntilRaw ? freeUntilRaw.toDate() : null;
    if (!grantsPro && (!freeUntil || freeUntil.getTime() <= Date.now())) return null;
    return { code: data.code as string, grantsPro, freeUntil };
  } catch {
    return null;
  }
}
