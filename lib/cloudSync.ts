import { Receipt } from '../types';
import {
  getCloudMigrationDone,
  setCloudMigrationDone,
} from './secureStorage';
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
                deleteReceiptLocally: (id: string, uid: string) => Promise<void>;
              };
              await deleteReceiptLocally(change.doc.id, uid);
            } else {
              const data = change.doc.data() as CloudReceipt;
              // eslint-disable-next-line @typescript-eslint/no-require-imports, global-require
              const { upsertReceiptFromCloud } = require('./database') as {
                upsertReceiptFromCloud: (cloud: CloudReceipt, uid: string) => Promise<void>;
              };
              await upsertReceiptFromCloud(data, uid);
            }
          } catch (e) {
            // eslint-disable-next-line no-console
            console.warn('[cloudSync] receipt snapshot apply failed:', (e as Error)?.message);
          }
        }
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
      createdAt:
        d.createdAt?.toDate?.()?.toISOString() ?? new Date().toISOString(),
      expiresAt: expiresAt.toISOString(),
    };
  } catch {
    return null;
  }
}

/**
 * Accept a pending invite. Moves the current user into the new
 * household: updates their users/{uid} doc, appends their uid to the
 * new household's memberUids, then deletes the invite. The user's
 * EXISTING local receipts are NOT moved to the new household — leaving
 * them in the user's original solo household, accessible if they
 * later "Leave household" back to it. For a future iteration, we'll
 * add an option to merge solo-household receipts into the new shared
 * one at accept time.
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
      tx.delete(inviteRef);
    });
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

/** Does a verified BalanceSheet user already own this phone number?
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
    await db.runTransaction(async (tx) => {
      const householdSnap = await tx.get(householdRef);
      if (!householdSnap.exists) throw new Error('household no longer exists');
      tx.update(householdRef, {
        memberUids: firestore.FieldValue.arrayUnion(uid),
        memberCount: firestore.FieldValue.increment(1),
        updatedAt: firestore.FieldValue.serverTimestamp(),
      });
      tx.set(userRef, { householdId, updatedAt: firestore.FieldValue.serverTimestamp() }, { merge: true });
      tx.delete(inviteRef);
    });
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
 * Remove the current user from their household. If the household has
 * other members, they keep the receipts; the leaver ends up in a fresh
 * solo household and continues using the app normally.
 *
 * If the leaver is the LAST member, the household is left intact (no
 * data loss) but orphaned — no security rule allows anyone else to
 * read it. A future iteration could delete it explicitly.
 */
export async function leaveCurrentHousehold(args: {
  uid: string;
  currentHouseholdId: string;
  email: string | null;
  displayName: string | null;
}): Promise<{ ok: true; newSoloHouseholdId: string } | { ok: false; reason: string }> {
  const firestore = loadFirestore();
  if (!firestore) return { ok: false, reason: 'cloud module not loaded' };
  try {
    const db = firestore();
    const oldRef = db.collection('households').doc(args.currentHouseholdId);
    const userRef = db.collection('users').doc(args.uid);

    // Step 1 — remove uid from the old household and decrement count.
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(oldRef);
      if (!snap.exists) return;
      tx.update(oldRef, {
        memberUids: firestore.FieldValue.arrayRemove(args.uid),
        memberCount: firestore.FieldValue.increment(-1),
        updatedAt: firestore.FieldValue.serverTimestamp(),
      });
    });

    // Step 2 — create a fresh solo household for this user, mirroring
    // what ensureHouseholdForUser does on first sign-in. We can't
    // reuse that function because it short-circuits if the user doc
    // already has a householdId.
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
        householdId: newHid,
        email: args.email,
        displayName: args.displayName,
        updatedAt: now,
      },
      { merge: true },
    );
    await batch.commit();
    return { ok: true, newSoloHouseholdId: newHid };
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
