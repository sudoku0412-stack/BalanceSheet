import { Receipt, Settlement } from '../types';
import {
  applyBudgetsSnapshot,
  BudgetsSnapshot,
  getCloudMigrationDone,
  setCloudMigrationDone,
} from './secureStorage';
import { notifyLocalDataChanged } from './dataSync';
// setReceiptPhotoUrl is imported lazily inside syncReceiptToCloud to
// avoid a circular dependency at module load: database.ts imports
// from cloudSync, and we only need this writeback path from within
// the post-upload code that runs after database.ts is already loaded.

/**
 * Cloud sync layer (Phase 2). Shadows the local SQLite layer with a
 * Firestore write so each receipt also lives in the cloud. Local
 * SQLite stays the authoritative source for reads — Firestore is a
 * durable backup today and the foundation for cross-device family
 * sharing in Phase 3.
 *
 * Defensive loading
 * -----------------
 * @react-native-firebase/firestore and @react-native-firebase/storage
 * are native modules. The current APK (and any OTA-only deploys to
 * older APKs) won't have them linked, so every call site has to
 * gracefully no-op if the modules aren't present. We mirror the
 * pattern used in lib/haptics.ts and lib/pdfExport.ts: probe-load on
 * first use, cache the result, and fail closed (just don't sync).
 *
 * The cloud features become live for a user the FIRST time they
 * launch an APK that includes the native deps. Before that they
 * still get a working app — just no cloud backup.
 *
 * Data model (Firestore)
 * ----------------------
 *   users/{uid}                      profile-ish doc, points to a household
 *   households/{hid}                 owner + member-count metadata
 *   households/{hid}/members/{uid}   role + joinedAt for each member
 *   households/{hid}/receipts/{rid}  full receipt payload
 *
 * On first sign-in we ensure users/{uid} exists. If it doesn't, we
 * create a brand-new solo household and stamp uid as the only
 * member. From then on `householdId` is the partition key for every
 * cloud read/write.
 */

type FirestoreModule = typeof import('@react-native-firebase/firestore').default;
type StorageModule = typeof import('@react-native-firebase/storage').default;

let cachedFirestore: FirestoreModule | null | undefined;
let cachedStorage: StorageModule | null | undefined;

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

function loadStorage(): StorageModule | null {
  if (cachedStorage !== undefined) return cachedStorage as StorageModule | null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports, global-require
    const mod = require('@react-native-firebase/storage').default;
    cachedStorage = typeof mod === 'function' ? mod : null;
  } catch {
    cachedStorage = null;
  }
  return cachedStorage as StorageModule | null;
}

export function isCloudSyncAvailable(): boolean {
  return loadFirestore() != null;
}

// ─── diagnostics (visible in Settings) ────────────────────────────────────
//
// Phase 2 cloud sync runs entirely in the background — local writes always
// succeed regardless of whether the cloud half landed. That's the right
// default for resilience but it makes debugging an empty Firestore very
// hard ("did it try? did it fail? did it never fire?"). Track every
// important step in a module-level snapshot the UI can render.

export type CloudSyncDiagnostics = {
  moduleAvailable: boolean;
  storageAvailable: boolean;
  householdId: string | null;
  lastBootstrap: { ok: boolean; at: string; message?: string } | null;
  lastReceiptSync: { ok: boolean; at: string; message?: string; receiptId?: string } | null;
  lastMigration: { migrated: number; failed: number; skipped: boolean; at: string } | null;
};

let diagnostics: CloudSyncDiagnostics = {
  moduleAvailable: false,
  storageAvailable: false,
  householdId: null,
  lastBootstrap: null,
  lastReceiptSync: null,
  lastMigration: null,
};

const listeners = new Set<() => void>();

export function getCloudSyncDiagnostics(): CloudSyncDiagnostics {
  // Recompute the module-availability flags on read so the panel reflects
  // the current state even if a downstream consumer triggered the load
  // path elsewhere.
  return {
    ...diagnostics,
    moduleAvailable: loadFirestore() != null,
    storageAvailable: loadStorage() != null,
  };
}

export function subscribeCloudSyncDiagnostics(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

function patchDiagnostics(p: Partial<CloudSyncDiagnostics>): void {
  diagnostics = { ...diagnostics, ...p };
  for (const fn of listeners) fn();
}

// ─── household bootstrap ───────────────────────────────────────────────────

/**
 * Make sure the signed-in user has a Firestore profile doc + a
 * household. Called on every auth state change after sign-in.
 * Idempotent: returns the existing householdId if one is already set,
 * otherwise creates a fresh single-member household.
 *
 * The household id is also cached on `users/{uid}.householdId` so
 * subsequent calls are a single read.
 */
export async function ensureHouseholdForUser(args: {
  uid: string;
  email?: string | null;
  displayName?: string | null;
}): Promise<string | null> {
  const firestore = loadFirestore();
  if (!firestore) {
    patchDiagnostics({
      lastBootstrap: {
        ok: false,
        at: new Date().toISOString(),
        message:
          '@react-native-firebase/firestore native module not loaded. Reinstall a Phase-2 APK or rebuild.',
      },
    });
    return null;
  }
  try {
    const db = firestore();
    const userRef = db.collection('users').doc(args.uid);
    const userSnap = await userRef.get();
    if (userSnap.exists && userSnap.data()?.householdId) {
      const existingHid = userSnap.data()!.householdId as string;
      // Refresh email + displayName on every sign-in so the Family
      // panel shows the latest values from Firebase Auth instead of
      // whatever was on the user object at first bootstrap (often
      // null on a freshly-created account). Merge so we don't blow
      // away other future fields.
      try {
        await userRef.set(
          {
            email: args.email ?? null,
            displayName: args.displayName ?? null,
            updatedAt: firestore.FieldValue.serverTimestamp(),
          },
          { merge: true },
        );
      } catch {
        // The refresh is a nice-to-have. If it fails (e.g. the user
        // rule is mid-update), we still return the household id —
        // the rest of the app proceeds normally.
      }
      patchDiagnostics({
        householdId: existingHid,
        lastBootstrap: {
          ok: true,
          at: new Date().toISOString(),
          message: 'existing household',
        },
      });
      return existingHid;
    }

    // Create a fresh solo household. Doc id is auto-generated so
    // collisions are impossible across users / re-runs.
    const hidRef = db.collection('households').doc();
    const hid = hidRef.id;
    const now = firestore.FieldValue.serverTimestamp();

    // Two batched writes — the user and the household. The members
    // subcollection is intentionally NOT written here: its security
    // rule looks up the parent household via get(), which returns
    // nothing during a batched create (rules see pre-batch state),
    // so the batch would fail with permission-denied on the members
    // doc. The `memberUids` array on the household doc is what every
    // real-life rule checks against; the members subcollection is
    // future Phase-3 territory for richer per-member metadata
    // (joinedAt, role transitions, etc.). When we add it then, we'll
    // write each members/{uid} doc AFTER the household already
    // exists, where the get() succeeds.
    const batch = db.batch();
    batch.set(userRef, {
      householdId: hid,
      email: args.email ?? null,
      displayName: args.displayName ?? null,
      createdAt: now,
      updatedAt: now,
    });
    batch.set(hidRef, {
      ownerUid: args.uid,
      memberUids: [args.uid],
      memberCount: 1,
      createdAt: now,
      updatedAt: now,
    });
    await batch.commit();
    patchDiagnostics({
      householdId: hid,
      lastBootstrap: {
        ok: true,
        at: new Date().toISOString(),
        message: 'new household created',
      },
    });
    return hid;
  } catch (e) {
    // Firestore not enabled in the console yet, network down, or
    // permissions denied. Cloud features just silently no-op until
    // the next attempt — local data is unaffected.
    patchDiagnostics({
      lastBootstrap: {
        ok: false,
        at: new Date().toISOString(),
        message: (e as Error)?.message ?? 'unknown',
      },
    });
    return null;
  }
}

// ─── receipts listener (cloud → local SQLite sync) ────────────────────────
//
// Phase 3 turns the previously one-way shadow-write into bidirectional
// sync. A Firestore `onSnapshot` subscription on the household's receipts
// collection fires whenever any device in the household writes a change.
// We mirror those changes into local SQLite via the upsertReceiptFromCloud
// path (defined in lib/database.ts, lazy-required to avoid a circular
// dep). The user's own writes echo back through this listener too, but
// that's a cheap idempotent local re-write — not an infinite loop, because
// the upsert path doesn't kick off another cloud write.

/**
 * Internal type for a receipt as it lives in Firestore. Same shape as
 * serializeReceipt produces. Field-level naming matches the Receipt
 * type so the converter is essentially a passthrough.
 */
interface CloudReceipt {
  id: string;
  storeName: string;
  date: string;
  totalAmount: number;
  subtotalAmount?: number | null;
  taxAmount?: number | null;
  category: string;
  categoryTags?: string[];
  rawText?: string | null;
  imageUri?: string | null;
  photoUrl?: string | null;
  notes?: string | null;
  paidBy?: string | null;
  createdBy?: string | null;
  isRecurringOccurrence?: boolean;
  lineItems?: Array<{
    id: string;
    name: string;
    amount: number;
    category?: string | null;
  }>;
  createdAt: string;
  updatedAt: string;
}

export function subscribeToHouseholdReceipts(
  householdId: string,
  uid: string,
): (() => void) | null {
  const firestore = loadFirestore();
  if (!firestore || !householdId || !uid) return null;
  try {
    const db = firestore();
    const col = db
      .collection('households')
      .doc(householdId)
      .collection('receipts');
    const unsub = col.onSnapshot(
      async (snapshot) => {
        if (!snapshot) return;
        for (const change of snapshot.docChanges()) {
          try {
            // Skip our own pending writes — they're already in local
            // SQLite (the write is what triggered the cloud round-trip
            // we're now observing). Without this, every save would
            // immediately rewrite the same row to SQLite, costing a
            // pointless transaction.
            if (change.doc.metadata.hasPendingWrites) continue;
            if (change.type === 'removed') {
              // eslint-disable-next-line @typescript-eslint/no-require-imports, global-require
              const { deleteReceiptLocally } = require('./database') as {
                deleteReceiptLocally: (id: string, uid: string, householdId: string) => Promise<void>;
              };
              await deleteReceiptLocally(change.doc.id, uid, householdId);
            } else {
              const data = change.doc.data() as CloudReceipt;
              // eslint-disable-next-line @typescript-eslint/no-require-imports, global-require
              const { upsertReceiptFromCloud } = require('./database') as {
                upsertReceiptFromCloud: (cloud: CloudReceipt, uid: string, householdId: string) => Promise<void>;
              };
              await upsertReceiptFromCloud(data, uid, householdId);
            }
          } catch (e) {
            // eslint-disable-next-line no-console
            console.warn('[cloudSync] receipt snapshot apply failed:', (e as Error)?.message);
          }
        }
        if (snapshot.docChanges().length > 0) notifyLocalDataChanged();
      },
      (err) => {
        // eslint-disable-next-line no-console
        console.warn('[cloudSync] receipts listener errored:', err?.message);
        patchDiagnostics({
          lastReceiptSync: {
            ok: false,
            at: new Date().toISOString(),
            message: `listener: ${err?.message ?? 'unknown'}`,
          },
        });
      },
    );
    return unsub;
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('[cloudSync] subscribeToHouseholdReceipts failed:', (e as Error)?.message);
    return null;
  }
}

/**
 * Mirror the verified phone number onto users/{uid} so Phase B's
 * phone-lookup Cloud Function has something to match against. Best-
 * effort/fire-and-forget like the receipt shadow-write below — local
 * SQLite (via lib/profile.ts's setProfilePhone) is already durable.
 */
export async function syncPhoneToCloud(
  uid: string,
  phone: string | null,
  verified: boolean,
): Promise<void> {
  const firestore = loadFirestore();
  if (!firestore) return;
  try {
    await firestore()
      .collection('users')
      .doc(uid)
      .set(
        {
          phone,
          phoneVerified: verified,
          updatedAt: firestore.FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('[cloudSync] syncPhoneToCloud failed:', (e as Error)?.message);
  }
}

// ─── push tokens (household activity notifications) ─────────────────────

/** Mirrors this device's Expo push token onto users/{uid}, same
 *  fire-and-forget pattern as syncPhoneToCloud. Overwritten on every
 *  fresh registration (lib/notifications.ts), so a reinstalled app or
 *  rotated token naturally replaces the stale one. */
export async function syncPushTokenToCloud(uid: string, token: string | null): Promise<void> {
  const firestore = loadFirestore();
  if (!firestore) return;
  try {
    await firestore()
      .collection('users')
      .doc(uid)
      .set(
        { pushToken: token, updatedAt: firestore.FieldValue.serverTimestamp() },
        { merge: true },
      );
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('[cloudSync] syncPushTokenToCloud failed:', (e as Error)?.message);
  }
}

export async function getPushTokensForUids(uids: string[]): Promise<string[]> {
  const firestore = loadFirestore();
  if (!firestore || uids.length === 0) return [];
  try {
    const db = firestore();
    const snaps = await Promise.all(uids.map((uid) => db.collection('users').doc(uid).get()));
    return snaps
      .map((s) => s.data()?.pushToken as string | undefined)
      .filter((t): t is string => !!t);
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('[cloudSync] getPushTokensForUids failed:', (e as Error)?.message);
    return [];
  }
}

/** Every OTHER household member's push token — reads users/{uid} for
 *  everyone in the household doc's memberUids except excludeUid. Uses
 *  the same "any member can read any member's users/{uid} doc" rule
 *  already in place for displayName/email (see firestore.rules). */
export async function getHouseholdMemberPushTokens(
  householdId: string,
  excludeUid: string,
): Promise<string[]> {
  const firestore = loadFirestore();
  if (!firestore || !householdId) return [];
  try {
    const householdSnap = await firestore().collection('households').doc(householdId).get();
    const memberUids = (householdSnap.data()?.memberUids as string[] | undefined) ?? [];
    const others = memberUids.filter((uid) => uid !== excludeUid);
    return getPushTokensForUids(others);
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('[cloudSync] getHouseholdMemberPushTokens failed:', (e as Error)?.message);
    return [];
  }
}

// ─── receipt shadow-write ─────────────────────────────────────────────────

/**
 * Mirror a receipt into Firestore. Fire-and-forget from the caller's
 * perspective — local SQLite is already the source of truth, this is
 * just durability + the data side of eventual family sharing.
 *
 * Errors are swallowed so a transient cloud failure never blocks the
 * local UX. We log to console at debug level so a developer can spot
 * sync issues during testing.
 */
export async function syncReceiptToCloud(
  receipt: Receipt,
  householdId: string,
): Promise<void> {
  const firestore = loadFirestore();
  if (!firestore || !householdId) {
    patchDiagnostics({
      lastReceiptSync: {
        ok: false,
        at: new Date().toISOString(),
        receiptId: receipt.id,
        message: !firestore ? 'firestore module not loaded' : 'no household id set',
      },
    });
    return;
  }
  try {
    // If the receipt has a local image and no cloud URL yet, push the
    // photo to Cloud Storage first so the Firestore doc lands with
    // photoUrl populated in a single write. uploadReceiptPhoto is
    // defensive — it returns null when Storage isn't available,
    // which leaves photoUrl unset (other devices won't see the
    // image, but the rest of the receipt syncs fine).
    let photoUrl: string | null = receipt.photoUrl ?? null;
    if (!photoUrl && receipt.imageUri) {
      photoUrl = await uploadReceiptPhoto({
        localUri: receipt.imageUri,
        householdId,
        receiptId: receipt.id,
      });
      // Persist back so the next save on this receipt skips re-upload.
      if (photoUrl) {
        try {
          // eslint-disable-next-line @typescript-eslint/no-require-imports, global-require
          const { setReceiptPhotoUrl } = require('./database') as {
            setReceiptPhotoUrl: (id: string, url: string) => Promise<void>;
          };
          await setReceiptPhotoUrl(receipt.id, photoUrl);
        } catch {
          // The cache writeback is a nice-to-have. If it fails the
          // next sync just re-uploads — bandwidth cost, not a bug.
        }
      }
    }

    const payload = serializeReceipt(
      { ...receipt, photoUrl: photoUrl ?? undefined } as Receipt,
      firestore,
    );
    const db = firestore();
    const ref = db
      .collection('households')
      .doc(householdId)
      .collection('receipts')
      .doc(receipt.id);
    await ref.set(payload);
    patchDiagnostics({
      lastReceiptSync: {
        ok: true,
        at: new Date().toISOString(),
        receiptId: receipt.id,
      },
    });
  } catch (e) {
    // Log but don't throw — the local write already succeeded.
    // eslint-disable-next-line no-console
    console.warn('[cloudSync] syncReceiptToCloud failed:', (e as Error)?.message);
    patchDiagnostics({
      lastReceiptSync: {
        ok: false,
        at: new Date().toISOString(),
        receiptId: receipt.id,
        message: (e as Error)?.message ?? 'unknown',
      },
    });
  }
}

export async function syncReceiptDeletionToCloud(
  receiptId: string,
  householdId: string,
): Promise<void> {
  const firestore = loadFirestore();
  if (!firestore || !householdId) return;
  try {
    const db = firestore();
    await db
      .collection('households')
      .doc(householdId)
      .collection('receipts')
      .doc(receiptId)
      .delete();
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn(
      '[cloudSync] syncReceiptDeletionToCloud failed:',
      (e as Error)?.message,
    );
  }
}

// ─── settlements ("settle up") ──────────────────────────────────────────────

/** Shadow-write a settlement to Firestore, same fire-and-forget pattern
 *  as syncReceiptToCloud. Settlements are immutable — this is always a
 *  fresh doc, never an update. */
export async function syncSettlementToCloud(
  settlement: Settlement,
  householdId: string,
): Promise<void> {
  const firestore = loadFirestore();
  if (!firestore || !householdId) return;
  try {
    const db = firestore();
    await db
      .collection('households')
      .doc(householdId)
      .collection('settlements')
      .doc(settlement.id)
      .set({
        fromUid: settlement.fromUid,
        toUid: settlement.toUid,
        amountUsd: settlement.amountUsd,
        createdAt: settlement.createdAt,
      });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('[cloudSync] syncSettlementToCloud failed:', (e as Error)?.message);
  }
}

/** Mirrors subscribeToHouseholdReceipts — listens for new settlement
 *  docs (added by ANY household member, on any device) and applies them
 *  locally. No 'removed' handling: settlements are never deleted. */
export function subscribeToHouseholdSettlements(
  householdId: string,
  uid: string,
): (() => void) | null {
  const firestore = loadFirestore();
  if (!firestore || !householdId || !uid) return null;
  try {
    const db = firestore();
    const col = db.collection('households').doc(householdId).collection('settlements');
    const unsub = col.onSnapshot(
      async (snapshot) => {
        if (!snapshot) return;
        for (const change of snapshot.docChanges()) {
          if (change.type === 'removed') continue;
          try {
            if (change.doc.metadata.hasPendingWrites) continue;
            const data = change.doc.data();
            // eslint-disable-next-line @typescript-eslint/no-require-imports, global-require
            const { upsertSettlementFromCloud } = require('./database') as {
              upsertSettlementFromCloud: (cloud: Settlement, uid: string, householdId: string) => Promise<void>;
            };
            await upsertSettlementFromCloud(
              {
                id: change.doc.id,
                fromUid: data.fromUid as string,
                toUid: data.toUid as string,
                amountUsd: data.amountUsd as number,
                createdAt: data.createdAt as string,
              },
              uid,
              householdId,
            );
          } catch (e) {
            // eslint-disable-next-line no-console
            console.warn('[cloudSync] settlement snapshot apply failed:', (e as Error)?.message);
          }
        }
        if (snapshot.docChanges().length > 0) notifyLocalDataChanged();
      },
      (err) => {
        // eslint-disable-next-line no-console
        console.warn('[cloudSync] settlements listener errored:', err?.message);
      },
    );
    return unsub;
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('[cloudSync] subscribeToHouseholdSettlements failed:', (e as Error)?.message);
    return null;
  }
}

// ─── household-wide budget sync ─────────────────────────────────────────────
//
// Budget amounts/alerts-toggle live in SecureStore (device-local — see
// lib/secureStorage.ts), with no cloud copy at all until now. That meant
// inviteUserToHousehold/addHouseholdMemberByPhone's `budgets` snapshot
// (stamped onto the invite doc, applied once on accept) only ever
// reached BRAND NEW members — anyone already in the household before
// that one-time copy never got it. Mirroring the budgets onto the
// household doc itself + a live listener fixes that generally: any
// member changing a budget pushes it here, and every other member
// (new or long-standing) picks it up on their next snapshot.

export async function syncBudgetsToCloud(
  householdId: string,
  budgets: BudgetsSnapshot,
): Promise<void> {
  const firestore = loadFirestore();
  if (!firestore || !householdId) return;
  try {
    await firestore()
      .collection('households')
      .doc(householdId)
      .set(
        { budgets, updatedAt: firestore.FieldValue.serverTimestamp() },
        { merge: true },
      );
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('[cloudSync] syncBudgetsToCloud failed:', (e as Error)?.message);
  }
}

/** Listens for budget changes on the household doc (from ANY member's
 *  device) and applies them locally. Skips this device's own pending
 *  write, same guard as the receipts/settlements listeners. */
export function subscribeToHouseholdBudgets(
  householdId: string,
): (() => void) | null {
  const firestore = loadFirestore();
  if (!firestore || !householdId) return null;
  try {
    const db = firestore();
    const ref = db.collection('households').doc(householdId);
    const unsub = ref.onSnapshot(
      async (snapshot) => {
        if (!snapshot || !snapshot.exists) return;
        if (snapshot.metadata.hasPendingWrites) return;
        const budgets = snapshot.data()?.budgets as BudgetsSnapshot | undefined;
        if (!budgets) return;
        try {
          await applyBudgetsSnapshot(householdId, budgets);
          notifyLocalDataChanged();
        } catch (e) {
          // eslint-disable-next-line no-console
          console.warn('[cloudSync] applying household budgets failed:', (e as Error)?.message);
        }
      },
      (err) => {
        // eslint-disable-next-line no-console
        console.warn('[cloudSync] household budgets listener errored:', err?.message);
      },
    );
    return unsub;
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('[cloudSync] subscribeToHouseholdBudgets failed:', (e as Error)?.message);
    return null;
  }
}

// ─── photo upload ─────────────────────────────────────────────────────────

/**
 * Upload a receipt photo to Cloud Storage so other household members
 * can view it. Returns the download URL on success, or null on
 * failure / when storage isn't available.
 *
 * Storage path: households/{hid}/photos/{receiptId}.jpg — one photo
 * per receipt, keyed by the same id so deletions in Firestore can
 * cascade-delete the storage object by name.
 */
export async function uploadReceiptPhoto(args: {
  localUri: string;
  householdId: string;
  receiptId: string;
}): Promise<string | null> {
  const storage = loadStorage();
  if (!storage || !args.householdId || !args.localUri) return null;
  try {
    const path = `households/${args.householdId}/photos/${args.receiptId}.jpg`;
    const ref = storage().ref(path);
    await ref.putFile(args.localUri);
    return await ref.getDownloadURL();
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('[cloudSync] uploadReceiptPhoto failed:', (e as Error)?.message);
    return null;
  }
}

// ─── invites + household membership (Phase 3) ─────────────────────────────

export type HouseholdMember = {
  uid: string;
  email: string | null;
  displayName: string | null;
  role: 'owner' | 'member';
  isYou: boolean;
};

export type PendingInvite = {
  email: string;
  householdId: string;
  householdName: string | null;
  invitedByUid: string;
  invitedByName: string | null;
  invitedByEmail: string | null;
  budgets: BudgetsSnapshot | null;
  createdAt: string;
  expiresAt: string;
};

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * List every user currently a member of a household, with display info
 * pulled from each user's `users/{uid}` doc. The household doc carries
 * `memberUids: string[]` as the source of truth; we look up each uid
 * one at a time to build the panel. Fine for households of up to a
 * dozen members — past that we'd need to batch with `in` queries.
 */
export async function getHouseholdMembers(args: {
  householdId: string;
  currentUid: string;
}): Promise<HouseholdMember[] | null> {
  const firestore = loadFirestore();
  if (!firestore || !args.householdId) return null;
  try {
    const db = firestore();
    const householdSnap = await db
      .collection('households')
      .doc(args.householdId)
      .get();
    if (!householdSnap.exists) return [];
    const data = householdSnap.data() ?? {};
    const memberUids = (data.memberUids as string[] | undefined) ?? [];
    const ownerUid = data.ownerUid as string | undefined;

    const members: HouseholdMember[] = [];
    // Fan-out reads of each user doc. Could be parallelized with
    // Promise.all but the typical household size is tiny and serial
    // keeps the network behaviour predictable for diagnostics.
    for (const uid of memberUids) {
      try {
        const userSnap = await db.collection('users').doc(uid).get();
        const u = userSnap.exists ? userSnap.data() ?? {} : {};
        members.push({
          uid,
          email: (u.email as string | null) ?? null,
          displayName: (u.displayName as string | null) ?? null,
          role: uid === ownerUid ? 'owner' : 'member',
          isYou: uid === args.currentUid,
        });
      } catch {
        // A read failure on a single member shouldn't sink the whole
        // panel — emit a stub so the UI can still show the uid.
        members.push({
          uid,
          email: null,
          displayName: null,
          role: uid === ownerUid ? 'owner' : 'member',
          isYou: uid === args.currentUid,
        });
      }
    }
    return members;
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('[cloudSync] getHouseholdMembers failed:', (e as Error)?.message);
    return null;
  }
}

// ─── multi-household membership ───────────────────────────────────────────
//
// `users/{uid}.householdId` now means "currently ACTIVE household," not
// "the user's only household." The actual set of households a user
// belongs to lives in `users/{uid}/memberships/{hid}` — a join table,
// self-write only (see firestore.rules). Existing single-household
// users are transparently promoted to "member of 1 household" the
// first time they open an app build that calls
// ensureMembershipForCurrentHousehold (from AuthContext, right after
// ensureHouseholdForUser resolves). No batch migration, no forced
// re-login — every write here is additive and idempotent.

export type HouseholdMembership = {
  householdId: string;
  name: string | null;
  role: 'owner' | 'member';
  memberCount: number;
  isDefault: boolean;
};

/** Idempotent: creates `users/{uid}/memberships/{hid}` if it doesn't
 *  already exist, looking up the household doc to determine owner vs.
 *  member. Called on every sign-in for the user's currently
 *  bootstrapped household — safe to call repeatedly. This is what
 *  transparently promotes every pre-existing single-household user to
 *  "member of 1 household" the first time they open an updated build. */
export async function ensureMembershipForCurrentHousehold(
  uid: string,
  householdId: string,
): Promise<void> {
  const firestore = loadFirestore();
  if (!firestore || !householdId) return;
  try {
    const db = firestore();
    const ref = db.collection('users').doc(uid).collection('memberships').doc(householdId);
    const snap = await ref.get();
    if (snap.exists) return;
    const householdSnap = await db.collection('households').doc(householdId).get();
    const isOwner = (householdSnap.data()?.ownerUid as string | undefined) === uid;
    await ref.set({
      householdId,
      role: isOwner ? 'owner' : 'member',
      joinedAt: firestore.FieldValue.serverTimestamp(),
      isDefault: true,
    });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('[cloudSync] ensureMembershipForCurrentHousehold failed:', (e as Error)?.message);
  }
}

/** Persists the user's currently-ACTIVE household id — a plain merge
 *  write onto `users/{uid}.householdId`, used by the switcher
 *  (AuthContext's setActiveHousehold) when a user manually switches
 *  between households they already belong to. Best-effort: local
 *  switching (lib/database.ts's currentHouseholdId) already happened
 *  by the time this is called, so a failure here just means the NEXT
 *  sign-in re-resolves to the old active household until retried. */
export async function persistActiveHouseholdId(uid: string, householdId: string): Promise<void> {
  const firestore = loadFirestore();
  if (!firestore) return;
  try {
    await firestore()
      .collection('users')
      .doc(uid)
      .set({ householdId, updatedAt: firestore.FieldValue.serverTimestamp() }, { merge: true });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('[cloudSync] persistActiveHouseholdId failed:', (e as Error)?.message);
  }
}

/** Every household the user belongs to, joined with each household
 *  doc's name/memberCount for the Households switcher screen. */
export async function getUserMemberships(uid: string): Promise<HouseholdMembership[]> {
  const firestore = loadFirestore();
  if (!firestore) return [];
  try {
    const db = firestore();
    const snap = await db.collection('users').doc(uid).collection('memberships').get();
    const out: HouseholdMembership[] = [];
    for (const doc of snap.docs) {
      const d = doc.data();
      const hid = (d.householdId as string) ?? doc.id;
      try {
        const hSnap = await db.collection('households').doc(hid).get();
        if (!hSnap.exists) {
          // The household was deleted (e.g. its owner deleted it via
          // Settings) — this membership doc is now a dangling pointer.
          // Self-heal: drop it from the list and clean up our own
          // membership doc (self-write, always allowed) so it doesn't
          // keep showing up as a broken entry on every future refresh.
          void doc.ref.delete().catch(() => {});
          continue;
        }
        const hData = hSnap.data() ?? {};
        out.push({
          householdId: hid,
          name: (hData.name as string | null) ?? null,
          role: (d.role as 'owner' | 'member') ?? 'member',
          memberCount: (hData.memberCount as number) ?? 1,
          isDefault: !!d.isDefault,
        });
      } catch {
        out.push({
          householdId: hid,
          name: null,
          role: (d.role as 'owner' | 'member') ?? 'member',
          memberCount: 1,
          isDefault: !!d.isDefault,
        });
      }
    }
    return out;
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('[cloudSync] getUserMemberships failed:', (e as Error)?.message);
    return [];
  }
}

/** Creates a brand-new, empty household owned by `uid` and adds the
 *  matching membership doc. Does NOT touch any of the user's existing
 *  memberships or their active householdId — the caller decides
 *  whether/when to switch to it (see AuthContext's setActiveHousehold). */
export async function createHousehold(args: {
  uid: string;
  name: string;
}): Promise<{ ok: true; householdId: string } | { ok: false; reason: string }> {
  const firestore = loadFirestore();
  if (!firestore) return { ok: false, reason: 'cloud module not loaded' };
  const name = args.name.trim();
  if (!name) return { ok: false, reason: 'name required' };
  try {
    const db = firestore();
    const hidRef = db.collection('households').doc();
    const hid = hidRef.id;
    const now = firestore.FieldValue.serverTimestamp();
    await hidRef.set({
      ownerUid: args.uid,
      memberUids: [args.uid],
      memberCount: 1,
      name,
      createdAt: now,
      updatedAt: now,
    });
    await db.collection('users').doc(args.uid).collection('memberships').doc(hid).set({
      householdId: hid,
      role: 'owner',
      joinedAt: now,
      isDefault: false,
    });
    return { ok: true, householdId: hid };
  } catch (e) {
    return { ok: false, reason: (e as Error)?.message ?? 'unknown' };
  }
}

/** Owner-only rename — used both for a brand-new household and for
 *  naming a legacy (pre-multi-household) household that was never
 *  given one. */
export async function renameHousehold(args: {
  householdId: string;
  name: string;
  uid: string;
}): Promise<{ ok: true } | { ok: false; reason: string }> {
  const firestore = loadFirestore();
  if (!firestore) return { ok: false, reason: 'cloud module not loaded' };
  const name = args.name.trim();
  if (!name) return { ok: false, reason: 'name required' };
  try {
    await firestore()
      .collection('households')
      .doc(args.householdId)
      .set(
        { name, updatedAt: firestore.FieldValue.serverTimestamp() },
        { merge: true },
      );
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: (e as Error)?.message ?? 'unknown' };
  }
}

/**
 * Send an invite for the given email to join the current user's
 * household. Writes `invites/{lowercased-email}`; the invitee picks it
 * up on their next sign-in. The invite expires 7 days after creation
 * — rules enforce expiresAt and the accept-side filter ignores expired
 * docs, but a periodic cleanup is left out for simplicity (a stale
 * pending invite just sits inert and can be re-issued by the inviter).
 */
export async function inviteUserToHousehold(args: {
  email: string;
  householdId: string;
  invitedByUid: string;
  invitedByEmail: string | null;
  invitedByName: string | null;
  /** Inviter's current budget alert settings — stamped onto the invite
   *  so the invitee starts with the SAME amounts once they accept. */
  budgets?: BudgetsSnapshot;
}): Promise<{ ok: true } | { ok: false; reason: string }> {
  const firestore = loadFirestore();
  if (!firestore) return { ok: false, reason: 'cloud module not loaded' };
  if (!args.householdId) return { ok: false, reason: 'no active household' };
  const email = normalizeEmail(args.email);
  if (!email || !email.includes('@')) {
    return { ok: false, reason: 'invalid email' };
  }
  try {
    const db = firestore();
    const now = firestore.FieldValue.serverTimestamp();
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    // Look up the household's display name for nicer UI on the
    // invitee side.
    const householdSnap = await db
      .collection('households')
      .doc(args.householdId)
      .get();
    const householdName =
      (householdSnap.data()?.name as string | undefined) ?? null;
    await db.collection('invites').doc(email).set({
      email,
      householdId: args.householdId,
      householdName,
      invitedByUid: args.invitedByUid,
      invitedByEmail: args.invitedByEmail,
      invitedByName: args.invitedByName,
      budgets: args.budgets ?? null,
      createdAt: now,
      expiresAt,
      status: 'pending',
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: (e as Error)?.message ?? 'unknown' };
  }
}

/**
 * Look up a pending invite for the signed-in user's email. Returns
 * null when no invite exists, the doc is expired, or any read fails.
 * Called by AuthContext after bootstrap so a fresh sign-in can
 * surface a join prompt.
 */
export async function getPendingInviteForEmail(
  email: string | null,
): Promise<PendingInvite | null> {
  const firestore = loadFirestore();
  if (!firestore || !email) return null;
  try {
    const db = firestore();
    const snap = await db
      .collection('invites')
      .doc(normalizeEmail(email))
      .get();
    if (!snap.exists) return null;
    const d = snap.data() ?? {};
    const expiresAt = d.expiresAt?.toDate
      ? (d.expiresAt.toDate() as Date)
      : new Date(d.expiresAt as string);
    if (Number.isFinite(expiresAt.getTime()) && expiresAt.getTime() < Date.now()) {
      return null;
    }
    return {
      email: (d.email as string) ?? email.toLowerCase(),
      householdId: d.householdId as string,
      householdName: (d.householdName as string | null) ?? null,
      invitedByUid: d.invitedByUid as string,
      invitedByName: (d.invitedByName as string | null) ?? null,
      invitedByEmail: (d.invitedByEmail as string | null) ?? null,
      budgets: (d.budgets as BudgetsSnapshot | null) ?? null,
      createdAt:
        d.createdAt?.toDate?.()?.toISOString() ?? new Date().toISOString(),
      expiresAt: expiresAt.toISOString(),
    };
  } catch {
    return null;
  }
}

/**
 * Accept a pending invite. Adds a new membership for the current user
 * (additive — existing memberships are untouched) and switches their
 * active household to the new one (matches the pre-multi-household
 * UX of an accept immediately putting you in the new household). The
 * user's EXISTING local receipts are NOT moved to the new household —
 * they stay attached to whichever household they were created under,
 * still visible by switching back. For a future iteration, we'll add
 * an option to merge solo-household receipts into the new shared one
 * at accept time.
 */
export async function acceptInvite(args: {
  invite: PendingInvite;
  uid: string;
}): Promise<{ ok: true; newHouseholdId: string } | { ok: false; reason: string }> {
  const firestore = loadFirestore();
  if (!firestore) return { ok: false, reason: 'cloud module not loaded' };
  try {
    const db = firestore();
    const newHid = args.invite.householdId;
    const userRef = db.collection('users').doc(args.uid);
    const householdRef = db.collection('households').doc(newHid);
    const inviteRef = db.collection('invites').doc(args.invite.email);
    const membershipRef = userRef.collection('memberships').doc(newHid);

    // Transaction so an interrupted accept doesn't leave the user
    // half-joined. memberUids uses arrayUnion to be idempotent if the
    // user somehow accepts twice.
    await db.runTransaction(async (tx) => {
      const householdSnap = await tx.get(householdRef);
      if (!householdSnap.exists) {
        throw new Error('household no longer exists');
      }
      tx.update(householdRef, {
        memberUids: firestore.FieldValue.arrayUnion(args.uid),
        memberCount: firestore.FieldValue.increment(1),
        updatedAt: firestore.FieldValue.serverTimestamp(),
      });
      tx.set(
        userRef,
        {
          householdId: newHid,
          updatedAt: firestore.FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
      tx.set(membershipRef, {
        householdId: newHid,
        role: 'member',
        joinedAt: firestore.FieldValue.serverTimestamp(),
        isDefault: false,
      });
      tx.delete(inviteRef);
    });
    if (args.invite.budgets) {
      try {
        await applyBudgetsSnapshot(newHid, args.invite.budgets);
      } catch {
        // Best-effort — joining the household already succeeded; a
        // failed budget copy just means the new member keeps whatever
        // (likely empty) budgets they had before.
      }
    }
    return { ok: true, newHouseholdId: newHid };
  } catch (e) {
    return { ok: false, reason: (e as Error)?.message ?? 'unknown' };
  }
}

// ─── phone-based invites ───────────────────────────────────────────────────
//
// Deliberately NOT a Cloud Function — this app doesn't have (and the
// owner isn't paying for) the Firebase Blaze plan Cloud Functions
// require. Everything here runs client-side against Firestore directly:
//   - `phoneIndex/{e164}` is a tiny pointer doc ({ uid }) written by a
//     user themselves when they verify their own phone (see
//     lib/phoneVerification.ts) — readable by any authenticated user
//     via a direct doc-id get, so matching a contact's number doesn't
//     require opening broad query access to the `users` collection.
//   - Actually SENDING the SMS (when no match exists) still needs a
//     secret-holding backend — that's the ONE piece that lives outside
//     Firestore, in a Cloudflare Worker (scripts/sms-invite-worker.ts,
//     free tier, no Blaze needed). See lib/phoneInvite.ts for the call.
//
// Consent model: no accept TAP is ever shown to the invitee, for
// matched existing users OR fresh signups — an explicit user decision,
// not the recommended default (invite-then-accept). It does mean adding
// someone by phone number, alone, is enough to eventually give them
// visibility into the household's shared receipts. Mechanically, the
// actual join is always a SELF-write performed by the invitee's own
// client (AuthContext.tsx's checkPendingPhoneInvite, or right after
// verifying a number in lib/phoneVerification.ts) — never the inviter
// writing into the invitee's account directly, which would need a new,
// risky Firestore rule (anyone-can-write-anyone's-householdId) and
// isn't needed for the "no prompt" requirement anyway.

export type PendingPhoneInvite = {
  phone: string; // E.164
  householdId: string;
  householdName: string | null;
  invitedByUid: string;
  invitedByName: string | null;
  createdAt: string;
  expiresAt: string;
};

/** Written by lib/phoneVerification.ts right after a phone number is
 *  verified — the ONLY write to this collection, always by the owning
 *  uid for their own number. */
export async function setPhoneIndex(uid: string, phoneE164: string): Promise<void> {
  const firestore = loadFirestore();
  if (!firestore) return;
  try {
    await firestore().collection('phoneIndex').doc(phoneE164).set({
      uid,
      updatedAt: firestore.FieldValue.serverTimestamp(),
    });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('[cloudSync] setPhoneIndex failed:', (e as Error)?.message);
  }
}

export async function clearPhoneIndex(phoneE164: string): Promise<void> {
  const firestore = loadFirestore();
  if (!firestore) return;
  try {
    await firestore().collection('phoneIndex').doc(phoneE164).delete();
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('[cloudSync] clearPhoneIndex failed:', (e as Error)?.message);
  }
}

/** Does a verified NestExpenseTracker user already own this phone number?
 *  Returns just uid/displayName — never email or anything else, since
 *  this is a contact-discovery surface (see lib/phoneInvite.ts). */
export async function lookupUserByPhone(
  phoneE164: string,
): Promise<{ uid: string; displayName: string | null } | null> {
  const firestore = loadFirestore();
  if (!firestore) return null;
  try {
    const db = firestore();
    const indexSnap = await db.collection('phoneIndex').doc(phoneE164).get();
    if (!indexSnap.exists) return null;
    const uid = indexSnap.data()?.uid as string | undefined;
    if (!uid) return null;
    const userSnap = await db.collection('users').doc(uid).get();
    return { uid, displayName: (userSnap.data()?.displayName as string | null) ?? null };
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('[cloudSync] lookupUserByPhone failed:', (e as Error)?.message);
    return null;
  }
}

/**
 * Add a contact to the household by phone number. Always writes a
 * pending `phoneInvites/{e164}` doc — the same doc shape whether or not
 * the number matches an existing user. The actual household join is
 * always performed by the INVITEE's own client (self-write, via
 * acceptPhoneInviteIfAny below), never by the inviter reaching into
 * someone else's account — that would need a Firestore rule letting one
 * user write another user's `users/{uid}.householdId`, which is both a
 * real security hole (anyone could hijack anyone else's household
 * assignment) and unnecessary here.
 *
 * "No accept tap" (the user's explicit decision) still holds: a matched
 * user's own device auto-joins with no prompt, just not at the literal
 * instant the inviter taps send — it happens the next time their app
 * checks phoneInvites (see AuthContext.tsx, mirroring the email-invite
 * pending check, and lib/phoneVerification.ts for freshly-verified
 * numbers). `matched` in the return value only affects whether the
 * caller should ALSO fire an SMS (skip it — they already have the app).
 */
export async function addHouseholdMemberByPhone(args: {
  phoneE164: string;
  householdId: string;
  invitedByUid: string;
  invitedByName: string | null;
  /** Inviter's current budget alert settings — same idea as
   *  inviteUserToHousehold's `budgets`, applied on the invitee's device
   *  once acceptPhoneInviteIfAny joins them. */
  budgets?: BudgetsSnapshot;
}): Promise<
  | { ok: true; matched: true; displayName: string | null }
  | { ok: true; matched: false }
  | { ok: false; reason: string }
> {
  const firestore = loadFirestore();
  if (!firestore) return { ok: false, reason: 'cloud module not loaded' };
  try {
    const match = await lookupUserByPhone(args.phoneE164);
    const db = firestore();
    const householdSnap = await db.collection('households').doc(args.householdId).get();
    const householdName = (householdSnap.data()?.name as string | undefined) ?? null;
    const now = firestore.FieldValue.serverTimestamp();
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    await db.collection('phoneInvites').doc(args.phoneE164).set({
      phone: args.phoneE164,
      householdId: args.householdId,
      householdName,
      invitedByUid: args.invitedByUid,
      invitedByName: args.invitedByName,
      budgets: args.budgets ?? null,
      createdAt: now,
      expiresAt,
      status: 'pending',
    });
    return match
      ? { ok: true, matched: true, displayName: match.displayName }
      : { ok: true, matched: false };
  } catch (e) {
    return { ok: false, reason: (e as Error)?.message ?? 'unknown' };
  }
}

/** Checked right after a NEW/existing user verifies a phone number
 *  (lib/phoneVerification.ts) — if someone had already sent a phone
 *  invite to this exact number, join that household automatically
 *  (same instant-join consent model as the matched-existing-user path
 *  above, just the other direction: the invitee arrives later). */
export async function acceptPhoneInviteIfAny(
  uid: string,
  phoneE164: string,
): Promise<{ joined: boolean; householdId?: string }> {
  const firestore = loadFirestore();
  if (!firestore) return { joined: false };
  try {
    const db = firestore();
    const inviteRef = db.collection('phoneInvites').doc(phoneE164);
    const snap = await inviteRef.get();
    if (!snap.exists) return { joined: false };
    const d = snap.data() ?? {};
    const expiresAt = d.expiresAt?.toDate ? (d.expiresAt.toDate() as Date) : new Date(d.expiresAt as string);
    if (Number.isFinite(expiresAt.getTime()) && expiresAt.getTime() < Date.now()) {
      await inviteRef.delete();
      return { joined: false };
    }
    const householdId = d.householdId as string;
    const householdRef = db.collection('households').doc(householdId);
    const userRef = db.collection('users').doc(uid);
    const membershipRef = userRef.collection('memberships').doc(householdId);
    await db.runTransaction(async (tx) => {
      const householdSnap = await tx.get(householdRef);
      if (!householdSnap.exists) throw new Error('household no longer exists');
      tx.update(householdRef, {
        memberUids: firestore.FieldValue.arrayUnion(uid),
        memberCount: firestore.FieldValue.increment(1),
        updatedAt: firestore.FieldValue.serverTimestamp(),
      });
      tx.set(userRef, { householdId, updatedAt: firestore.FieldValue.serverTimestamp() }, { merge: true });
      tx.set(membershipRef, {
        householdId,
        role: 'member',
        joinedAt: firestore.FieldValue.serverTimestamp(),
        isDefault: false,
      });
      tx.delete(inviteRef);
    });
    const budgets = (d.budgets as BudgetsSnapshot | null) ?? null;
    if (budgets) {
      try {
        await applyBudgetsSnapshot(householdId, budgets);
      } catch {
        // Best-effort — joining already succeeded.
      }
    }
    return { joined: true, householdId };
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('[cloudSync] acceptPhoneInviteIfAny failed:', (e as Error)?.message);
    return { joined: false };
  }
}

export async function declineInvite(args: {
  invite: PendingInvite;
}): Promise<{ ok: boolean }> {
  const firestore = loadFirestore();
  if (!firestore) return { ok: false };
  try {
    const db = firestore();
    await db.collection('invites').doc(args.invite.email).delete();
    return { ok: true };
  } catch {
    return { ok: false };
  }
}

/**
 * Remove the current user from ONE specific household (explicit
 * target — the user may belong to several now, so there's no longer a
 * single implicit "current" one to leave). If other members remain in
 * it, they keep the receipts; this user's membership doc is deleted.
 *
 * Returns which household should become active next:
 *   - another of the user's remaining memberships (their `isDefault`
 *     one if they have one, else whichever else remains), or
 *   - a freshly-fabricated solo household, if this was their last
 *     membership — identical fallback to the old single-household
 *     behavior, just now only triggered when there's truly nothing
 *     left to fall back to.
 *
 * The caller (AuthContext's setActiveHousehold) is responsible for
 * actually switching local/active state to the returned household id
 * — this function only mutates Firestore.
 *
 * If the leaver was the household's LAST member, the household doc is
 * left intact (no data loss) but orphaned — no security rule allows
 * anyone else to read it. A future iteration could delete it explicitly.
 */
export async function leaveHousehold(args: {
  uid: string;
  householdId: string;
  email: string | null;
  displayName: string | null;
}): Promise<{ ok: true; nextActiveHouseholdId: string } | { ok: false; reason: string }> {
  const firestore = loadFirestore();
  if (!firestore) return { ok: false, reason: 'cloud module not loaded' };
  try {
    const db = firestore();
    const oldRef = db.collection('households').doc(args.householdId);
    const userRef = db.collection('users').doc(args.uid);
    const membershipRef = userRef.collection('memberships').doc(args.householdId);

    // Step 1 — remove uid from the old household, decrement count, and
    // delete this user's membership doc for it.
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(oldRef);
      if (snap.exists) {
        tx.update(oldRef, {
          memberUids: firestore.FieldValue.arrayRemove(args.uid),
          memberCount: firestore.FieldValue.increment(-1),
          updatedAt: firestore.FieldValue.serverTimestamp(),
        });
      }
      tx.delete(membershipRef);
    });

    // Step 2 — do any other memberships remain? Prefer the one flagged
    // isDefault, else whichever else is left.
    const remaining = await getUserMemberships(args.uid);
    const stillOther = remaining.filter((m) => m.householdId !== args.householdId);
    if (stillOther.length > 0) {
      const next = stillOther.find((m) => m.isDefault) ?? stillOther[0];
      return { ok: true, nextActiveHouseholdId: next.householdId };
    }

    // Step 3 — last membership gone: fabricate a fresh solo household,
    // mirroring what ensureHouseholdForUser does on first sign-in (that
    // function short-circuits if the user doc already has a
    // householdId, so it can't be reused here).
    const newRef = db.collection('households').doc();
    const newHid = newRef.id;
    const now = firestore.FieldValue.serverTimestamp();
    const batch = db.batch();
    batch.set(newRef, {
      ownerUid: args.uid,
      memberUids: [args.uid],
      memberCount: 1,
      createdAt: now,
      updatedAt: now,
    });
    batch.set(
      userRef,
      {
        email: args.email,
        displayName: args.displayName,
        updatedAt: now,
      },
      { merge: true },
    );
    batch.set(userRef.collection('memberships').doc(newHid), {
      householdId: newHid,
      role: 'owner',
      joinedAt: now,
      isDefault: true,
    });
    await batch.commit();
    return { ok: true, nextActiveHouseholdId: newHid };
  } catch (e) {
    return { ok: false, reason: (e as Error)?.message ?? 'unknown' };
  }
}

// ─── delete-account cleanup (Phase 3) ─────────────────────────────────────

/**
 * Wipe every cloud trace of the current user before Firebase Auth
 * actually deletes their account. Called by AuthContext.deleteAccount.
 *
 * Two cases:
 *
 *   Solo household (memberCount <= 1):
 *     - Delete every receipt doc under households/{hid}/receipts/.
 *     - Delete every photo under households/{hid}/photos/ (best effort —
 *       only fires when Cloud Storage is wired up).
 *     - Delete the household doc itself.
 *
 *   Shared household (memberCount > 1):
 *     - Remove the user's uid from the household's memberUids and
 *       decrement memberCount. The other family members keep all the
 *       receipts and photos.
 *
 * Either way we also:
 *     - Delete users/{uid}.
 *     - Delete any pending invite addressed to this user's email
 *       (invites/{lowercased-email}).
 *
 * Order matters: every Firestore write requires an authenticated
 * token. We MUST do all of this BEFORE the Firebase Auth account is
 * deleted, otherwise the subsequent writes get rejected with
 * permission-denied and the data is permanently orphaned (no other
 * user can clean it up because the rules require household
 * membership).
 *
 * Best effort throughout — if any individual step fails (network,
 * rules, missing doc), we log it and continue. A partially-failed
 * cleanup is still much better than leaving everything behind.
 */
export async function deleteCloudUserData(args: {
  uid: string;
  householdId: string | null;
  email: string | null;
}): Promise<{ receiptsDeleted: number; soloHouseholdDeleted: boolean }> {
  const firestore = loadFirestore();
  if (!firestore) {
    return { receiptsDeleted: 0, soloHouseholdDeleted: false };
  }
  let receiptsDeleted = 0;
  let soloHouseholdDeleted = false;
  try {
    const db = firestore();

    // Handle the household first since it requires membership.
    if (args.householdId) {
      const hRef = db.collection('households').doc(args.householdId);
      try {
        const hSnap = await hRef.get();
        if (hSnap.exists) {
          const data = hSnap.data() ?? {};
          const memberUids = (data.memberUids as string[] | undefined) ?? [];
          const isSolo = memberUids.length <= 1;
          if (isSolo) {
            // Delete every receipt under this household. Chunked
            // batched deletes — 400 per batch (Firestore caps at 500).
            const receiptsCol = hRef.collection('receipts');
            // Pagination loop: pull all docs up front since the
            // typical user has at most a few hundred receipts.
            const snap = await receiptsCol.get();
            const docs = snap.docs;
            const CHUNK = 400;
            for (let i = 0; i < docs.length; i += CHUNK) {
              const batch = db.batch();
              for (const d of docs.slice(i, i + CHUNK)) batch.delete(d.ref);
              try {
                await batch.commit();
                receiptsDeleted += Math.min(CHUNK, docs.length - i);
              } catch {
                // Try one-by-one as a fallback.
                for (const d of docs.slice(i, i + CHUNK)) {
                  try {
                    await d.ref.delete();
                    receiptsDeleted++;
                  } catch {
                    // skip
                  }
                }
              }
            }
            // Best-effort photo cleanup. The Storage module is only
            // available on a Blaze-upgraded project; on Spark this
            // silently no-ops.
            await tryDeleteHouseholdPhotos(args.householdId, docs.map((d) => d.id));
            // Finally the household itself.
            try {
              await hRef.delete();
              soloHouseholdDeleted = true;
            } catch {
              // ignore
            }
          } else {
            // Shared household: just remove our membership.
            try {
              await hRef.update({
                memberUids: firestore.FieldValue.arrayRemove(args.uid),
                memberCount: firestore.FieldValue.increment(-1),
                updatedAt: firestore.FieldValue.serverTimestamp(),
              });
            } catch {
              // ignore
            }
          }
        }
      } catch {
        // ignore household errors
      }
    }

    // User doc — always delete.
    try {
      await db.collection('users').doc(args.uid).delete();
    } catch {
      // ignore
    }

    // Any pending invite addressed to this user. We can only target
    // it by the doc id (lowercased email); if the user has no email
    // (phone-only auth) there's nothing to delete.
    if (args.email) {
      try {
        await db.collection('invites').doc(normalizeEmail(args.email)).delete();
      } catch {
        // ignore
      }
    }
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('[cloudSync] deleteCloudUserData failed:', (e as Error)?.message);
  }
  return { receiptsDeleted, soloHouseholdDeleted };
}

/**
 * Owner-only permanent delete of an entire household: every receipt +
 * settlement doc and photo under it, then the household doc itself,
 * then the owner's own membership doc. Caller (Settings) is
 * responsible for auto-settling any pending balances FIRST — this
 * function just destroys data, it doesn't check balances.
 *
 * Other members' `users/{uid}/memberships/{hid}` docs are intentionally
 * left dangling — this client has no write access to another user's
 * memberships subcollection (self-write only, see firestore.rules).
 * getUserMemberships self-heals this: any member whose membership
 * points at a now-missing household doc has it filtered out (and
 * cleaned up) on their next refresh. This mirrors the existing
 * "leaving your last household leaves it orphaned" tolerance already
 * in this codebase (see leaveHousehold's doc comment) rather than
 * introducing a new cross-user write rule just for this.
 *
 * Order matters: receipts/settlements/photos must be deleted BEFORE
 * the household doc, because their security rule looks up the parent
 * household via get() — deleting the household doc first would make
 * every subsequent subcollection delete get denied.
 */
export async function deleteHousehold(args: {
  householdId: string;
  uid: string;
}): Promise<{ ok: true; receiptsDeleted: number } | { ok: false; reason: string }> {
  const firestore = loadFirestore();
  if (!firestore) return { ok: false, reason: 'cloud module not loaded' };
  try {
    const db = firestore();
    const hRef = db.collection('households').doc(args.householdId);
    const hSnap = await hRef.get();
    if (!hSnap.exists) return { ok: false, reason: 'household no longer exists' };
    if ((hSnap.data()?.ownerUid as string | undefined) !== args.uid) {
      return { ok: false, reason: 'only the owner can delete this household' };
    }

    let receiptsDeleted = 0;
    const receiptsCol = hRef.collection('receipts');
    const receiptsSnap = await receiptsCol.get();
    const receiptDocs = receiptsSnap.docs;
    const CHUNK = 400;
    for (let i = 0; i < receiptDocs.length; i += CHUNK) {
      const batch = db.batch();
      for (const d of receiptDocs.slice(i, i + CHUNK)) batch.delete(d.ref);
      try {
        await batch.commit();
        receiptsDeleted += Math.min(CHUNK, receiptDocs.length - i);
      } catch {
        for (const d of receiptDocs.slice(i, i + CHUNK)) {
          try {
            await d.ref.delete();
            receiptsDeleted++;
          } catch {
            // skip
          }
        }
      }
    }
    await tryDeleteHouseholdPhotos(args.householdId, receiptDocs.map((d) => d.id));

    const settlementsCol = hRef.collection('settlements');
    const settlementsSnap = await settlementsCol.get();
    for (let i = 0; i < settlementsSnap.docs.length; i += CHUNK) {
      const batch = db.batch();
      for (const d of settlementsSnap.docs.slice(i, i + CHUNK)) batch.delete(d.ref);
      try {
        await batch.commit();
      } catch {
        for (const d of settlementsSnap.docs.slice(i, i + CHUNK)) {
          try {
            await d.ref.delete();
          } catch {
            // skip
          }
        }
      }
    }

    await hRef.delete();
    await db.collection('users').doc(args.uid).collection('memberships').doc(args.householdId).delete();

    return { ok: true, receiptsDeleted };
  } catch (e) {
    return { ok: false, reason: (e as Error)?.message ?? 'unknown' };
  }
}

async function tryDeleteHouseholdPhotos(
  householdId: string,
  receiptIds: string[],
): Promise<void> {
  const storage = loadStorage();
  if (!storage) return;
  for (const rid of receiptIds) {
    try {
      await storage().ref(`households/${householdId}/photos/${rid}.jpg`).delete();
    } catch {
      // Storage delete throws when the object doesn't exist — fine,
      // means we never uploaded a photo for this receipt.
    }
  }
}

// ─── one-shot backfill of pre-existing local data ─────────────────────────

/**
 * The FIRST time this user launches the cloud-aware build, walk every
 * local receipt and upload it to Firestore. After a successful run
 * (or partial — see fail-counter below) we set a per-user marker in
 * SecureStore so this never repeats.
 *
 * Called by AuthContext immediately after ensureHouseholdForUser
 * resolves with a non-null hid. Safe to call on every sign-in; the
 * marker check short-circuits all but the first run per user.
 *
 * Receipts are accepted as an injected lazy loader so this module
 * doesn't take a hard import on lib/database.ts (which already
 * imports cloudSync — that would be a circular dep).
 */
export async function migrateLocalReceiptsToCloud(args: {
  uid: string;
  householdId: string;
  loadAllReceipts: () => Promise<Receipt[]>;
}): Promise<{ migrated: number; failed: number; skipped: boolean }> {
  const firestore = loadFirestore();
  if (!firestore || !args.householdId) {
    return { migrated: 0, failed: 0, skipped: true };
  }
  const already = await getCloudMigrationDone(args.uid).catch(() => false);
  if (already) return { migrated: 0, failed: 0, skipped: true };

  let migrated = 0;
  let failed = 0;
  try {
    const all = await args.loadAllReceipts();
    const db = firestore();
    const col = db
      .collection('households')
      .doc(args.householdId)
      .collection('receipts');

    // Firestore tops out at 500 ops per batch; we chunk at 400 to
    // leave headroom for the household-doc updates we might add
    // later, and to keep any single network blip from killing the
    // entire migration.
    const CHUNK = 400;
    for (let i = 0; i < all.length; i += CHUNK) {
      const chunk = all.slice(i, i + CHUNK);
      const batch = db.batch();
      for (const r of chunk) {
        batch.set(col.doc(r.id), serializeReceipt(r, firestore));
      }
      try {
        await batch.commit();
        migrated += chunk.length;
      } catch {
        // Fall back to individual writes so one bad doc doesn't sink
        // the whole chunk.
        for (const r of chunk) {
          try {
            await col.doc(r.id).set(serializeReceipt(r, firestore));
            migrated++;
          } catch {
            failed++;
          }
        }
      }
    }
    // Only mark done when the migration completed without any
    // failures — a partial run will retry on the next launch, which
    // is idempotent because we use set() with deterministic doc ids.
    if (failed === 0) await setCloudMigrationDone(args.uid);
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('[cloudSync] migrateLocalReceiptsToCloud failed:', (e as Error)?.message);
  }
  patchDiagnostics({
    lastMigration: {
      migrated,
      failed,
      skipped: false,
      at: new Date().toISOString(),
    },
  });
  return { migrated, failed, skipped: false };
}

// ─── helpers ──────────────────────────────────────────────────────────────

/**
 * Firestore rejects a write OUTRIGHT (the whole document, not just the
 * offending field) if ANY field — including nested ones — is
 * `undefined`. `Receipt.split.values` is explicitly `undefined` for
 * the 'equal' method (see app/edit/[id].tsx), so any equal-split
 * receipt's cloud write was failing silently and completely: the
 * receipt itself never left this device. Recursively convert
 * `undefined` to `null` so a nested optional field can never
 * accidentally take down the entire sync.
 */
function stripUndefinedDeep(value: unknown): unknown {
  if (value === undefined) return null;
  if (Array.isArray(value)) return value.map(stripUndefinedDeep);
  if (value !== null && typeof value === 'object' && !(value instanceof Date)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = stripUndefinedDeep(v);
    }
    return out;
  }
  return value;
}

function serializeReceipt(
  r: Receipt,
  firestore: FirestoreModule,
): Record<string, unknown> {
  // Firestore stores everything as plain JSON-able values. Coerce
  // dates to strings (the rest of the app uses ISO strings already)
  // and replace timestamps with server-side ones where helpful.
  const payload = {
    id: r.id,
    storeName: r.storeName,
    date: r.date,
    totalAmount: r.totalAmount,
    subtotalAmount: r.subtotalAmount ?? null,
    taxAmount: r.taxAmount ?? null,
    category: r.category,
    categoryTags: r.categoryTags ?? [r.category],
    rawText: r.rawText ?? null,
    imageUri: r.imageUri ?? null,
    photoUrl: (r as Receipt & { photoUrl?: string | null }).photoUrl ?? null,
    notes: r.notes ?? null,
    split: r.split ?? null,
    recurring: r.recurring ?? null,
    paidBy: r.paidBy ?? null,
    createdBy: r.createdBy ?? null,
    isRecurringOccurrence: r.isRecurringOccurrence ?? false,
    lineItems: (r.lineItems ?? []).map((it) => ({
      id: it.id,
      name: it.name,
      amount: it.amount,
      category: it.category ?? null,
      splitWith: it.splitWith ?? [],
    })),
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
  return {
    ...(stripUndefinedDeep(payload) as Record<string, unknown>),
    // serverTimestamp() is a Firestore sentinel object, not plain JSON —
    // stripUndefinedDeep would otherwise recurse into and mangle it, so
    // it's added back AFTER sanitizing, not passed through above.
    syncedAt: firestore.FieldValue.serverTimestamp(),
  };
}
