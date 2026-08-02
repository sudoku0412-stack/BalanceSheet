import * as SQLite from 'expo-sqlite';
import { Receipt, LineItem } from '../types';
import {
  syncReceiptDeletionToCloud,
  syncReceiptToCloud,
  uploadReceiptPhoto,
} from './cloudSync';

const db = SQLite.openDatabaseSync('receipts.db');

// ─── per-user scoping ──────────────────────────────────────────────────────
//
// Receipts, line items, and correction history are scoped to the currently
// authenticated user. We hold the uid as a module-level value that the
// AuthContext sets whenever Firebase fires onAuthStateChanged. Database
// functions that mutate or read user data require it to be non-null and
// stamp every INSERT / filter every SELECT with it.
//
// Why a module global instead of passing uid through every call site:
// the alternative is to thread uid into the 30+ database read/write paths
// (and into every callback in every screen). The module-global pattern
// keeps existing call sites unchanged — only the wiring at the AuthContext
// boundary moves. It's safe in single-threaded RN JS where there's exactly
// one current user at a time.

let currentUserId: string | null = null;
// Phase 2: cloud sync writes need a partition key. Stamped by
// AuthContext after ensureHouseholdForUser resolves. Stays null in
// local-only mode (older APK without Firestore, or before the
// console-side setup is done) — shadow writes silently skip when
// there's no household.
let currentHouseholdId: string | null = null;

export function setCurrentHouseholdId(hid: string | null): void {
  currentHouseholdId = hid;
}

export function getCurrentHouseholdId(): string | null {
  return currentHouseholdId;
}

/**
 * Set or clear the currently authenticated user. Called by AuthContext
 * on every auth state change. Passing `null` (e.g. on sign-out) puts
 * the database layer into a defensive mode where read/write ops throw
 * rather than silently expose another user's data.
 *
 * When called with a non-null uid AFTER a schema upgrade, this also
 * stamps any rows that pre-dated the user_id column with the current
 * uid. The stamp is idempotent — it only touches rows where user_id
 * is NULL, which can only happen once per device per migration.
 */
export async function setCurrentUserId(uid: string | null): Promise<void> {
  currentUserId = uid;
  if (uid) {
    await backfillUnscopedRows(uid);
  }
}

export function getCurrentUserId(): string | null {
  return currentUserId;
}

function requireUserId(op: string): string {
  if (!currentUserId) {
    throw new Error(
      `No authenticated user (op: ${op}). Sign in before calling user-scoped database operations.`,
    );
  }
  return currentUserId;
}

async function backfillUnscopedRows(uid: string): Promise<void> {
  // Stamps any pre-migration rows (user_id IS NULL) with the current
  // user's uid. On a device that has only ever been used by one user,
  // this correctly attributes their existing receipts to them. On a
  // device that gets a second user signing in BEFORE the first user
  // ever launched the upgraded app, both share the unscoped rows —
  // realistically an edge case (multi-user-on-same-device wasn't
  // supported by the old app), and the first-signed-in user wins.
  try {
    await db.runAsync(`UPDATE receipts SET user_id = ? WHERE user_id IS NULL`, [
      uid,
    ]);
    await db.runAsync(
      `UPDATE receipt_corrections SET user_id = ? WHERE user_id IS NULL`,
      [uid],
    );
  } catch {
    // The columns may not exist yet on a fresh install where init has
    // not yet run; that's fine, there are no rows to backfill either.
  }
}

export async function initDatabase(): Promise<void> {
  await db.execAsync(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS receipts (
      id              TEXT PRIMARY KEY,
      store_name      TEXT NOT NULL,
      date            TEXT NOT NULL,
      total_amount    REAL NOT NULL DEFAULT 0,
      subtotal_amount REAL,
      tax_amount      REAL,
      category        TEXT NOT NULL DEFAULT 'Other',
      raw_text        TEXT,
      image_uri       TEXT,
      notes           TEXT,
      created_at      TEXT NOT NULL,
      updated_at      TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS line_items (
      id          TEXT PRIMARY KEY,
      receipt_id  TEXT NOT NULL,
      name        TEXT NOT NULL,
      amount      REAL NOT NULL,
      category    TEXT,
      FOREIGN KEY (receipt_id) REFERENCES receipts(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_receipts_date     ON receipts(date);
    CREATE INDEX IF NOT EXISTS idx_receipts_category ON receipts(category);
    CREATE INDEX IF NOT EXISTS idx_lineitems_receipt ON line_items(receipt_id);

    CREATE TABLE IF NOT EXISTS profiles (
      uid         TEXT PRIMARY KEY,
      first_name  TEXT NOT NULL,
      last_name   TEXT NOT NULL,
      created_at  TEXT NOT NULL,
      updated_at  TEXT NOT NULL
    );
  `);

  // Migrations for columns added after initial release. ALTER TABLE has no
  // IF NOT EXISTS, so each ADD COLUMN is wrapped to swallow duplicate-column
  // errors on already-migrated databases.
  for (const sql of [
    `ALTER TABLE profiles    ADD COLUMN photo_uri        TEXT`,
    `ALTER TABLE receipts    ADD COLUMN subtotal_amount  REAL`,
    `ALTER TABLE receipts    ADD COLUMN tax_amount       REAL`,
    `ALTER TABLE receipts    ADD COLUMN category_tags    TEXT`,
    `ALTER TABLE line_items  ADD COLUMN category         TEXT`,
    // Per-user scoping. Nullable on existing rows; backfilled with
    // the current uid by setCurrentUserId() on the first sign-in
    // after the schema migration.
    `ALTER TABLE receipts             ADD COLUMN user_id  TEXT`,
    `ALTER TABLE receipt_corrections  ADD COLUMN user_id  TEXT`,
    // Phase 2: cached Cloud Storage URL of the receipt photo so we
    // don't re-upload it on every shadow-write. Filled in by the
    // post-upload writeback in setReceiptPhotoUrl().
    `ALTER TABLE receipts             ADD COLUMN photo_url TEXT`,
    // Splitwise-style split state (enabled flag, participant uids,
    // method, per-participant percent/amount values), serialized as
    // JSON. See Receipt['split'] in types/index.ts.
    `ALTER TABLE receipts             ADD COLUMN split_json TEXT`,
    // Per-item split participants (JSON array of participant ids).
    // See LineItem['splitWith'] in types/index.ts.
    `ALTER TABLE line_items           ADD COLUMN split_with TEXT`,
    // Auto-repeat config (frequency, next due date, end date), JSON.
    // See Receipt['recurring'] in types/index.ts.
    `ALTER TABLE receipts             ADD COLUMN recurring_json TEXT`,
    // Currency this receipt was actually entered in. See
    // Receipt['originalCurrency'] in types/index.ts.
    `ALTER TABLE receipts             ADD COLUMN original_currency TEXT`,
    // Optional verified phone number (E.164), added anytime from Settings.
    // See Profile['phone']/['phoneVerified'] in lib/profile.ts.
    `ALTER TABLE profiles             ADD COLUMN phone            TEXT`,
    `ALTER TABLE profiles             ADD COLUMN phone_verified   INTEGER`,
    // Who fronted the money for a split receipt (household member uid).
    // Defaults to the receipt's own creator when unset. See
    // Receipt['paidBy'] in types/index.ts.
    `ALTER TABLE receipts             ADD COLUMN paid_by          TEXT`,
  ]) {
    try {
      await db.execAsync(sql);
    } catch {
      // column already exists
    }
  }

  // Filtering index for the user-scoped lookups. Most read paths
  // (getAllReceipts, getReceiptsByMonth, searchReceipts) filter by
  // user_id; adding it ahead of an existing index keeps date-sorted
  // scans inside the user partition fast even when the table grows.
  try {
    await db.execAsync(
      `CREATE INDEX IF NOT EXISTS idx_receipts_user      ON receipts(user_id);
       CREATE INDEX IF NOT EXISTS idx_receipts_user_date ON receipts(user_id, date);
       CREATE INDEX IF NOT EXISTS idx_corrections_user_store
         ON receipt_corrections(user_id, store_name);`,
    );
  } catch {
    // Indices on a not-yet-migrated table — safe to ignore.
  }

  // Cache for the async classifier — keyed by the cleaned, lowercased item
  // name. Lets us avoid re-querying the backend for repeat items.
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS item_classifications (
      cleaned_name TEXT PRIMARY KEY,
      category     TEXT NOT NULL,
      source       TEXT NOT NULL,  -- 'local' or 'remote'
      created_at   TEXT NOT NULL
    );
  `);

  // User-correction memory. When a user manually edits items after a
  // scan, we save the (storeName, rawOcr, finalItems) tuple here. On
  // the next scan from the same store the Gemini prompt loads the
  // 1-2 most recent corrections and includes them as in-context
  // examples — so the AI generalizes from how this specific user
  // treats their specific stores' receipt formats.
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS receipt_corrections (
      id           TEXT PRIMARY KEY,
      store_name   TEXT NOT NULL,
      raw_ocr      TEXT NOT NULL,
      items_json   TEXT NOT NULL,
      created_at   TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_corrections_store
      ON receipt_corrections(store_name);
  `);

  // Cache of Gemini parse results keyed by the OCR text hash. Lets
  // repeat scans of the same receipt (common during testing or when
  // the user retries after a transient error) reuse the prior result
  // instead of burning another quota request.
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS gemini_cache (
      text_hash    TEXT PRIMARY KEY,
      response_json TEXT NOT NULL,
      created_at   TEXT NOT NULL
    );
  `);
}

/**
 * Fast non-cryptographic hash (FNV-1a 32-bit). Good enough to key a
 * local cache where collisions are statistically irrelevant for the
 * data sizes we deal with (a few hundred scans over the app's life).
 */
function fnv1aHash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

// Bump whenever the AI prompt / parsing logic changes so existing
// cache entries (which may contain BAD parses from the old prompt)
// no longer match. The shape of the cached payload is the same, but
// changing the hash input forces a fresh AI call for previously-cached
// OCRs and a clean re-cache under the new key.
const CACHE_KEY_VERSION = 'v2';

export function hashOcrText(rawOcr: string): string {
  // Normalize whitespace + case so trivially-different OCR runs of
  // the same receipt hit the same cache key. Prefix with the cache
  // version so a prompt change invalidates stale entries.
  const normalized = rawOcr.toLowerCase().replace(/\s+/g, ' ').trim();
  return fnv1aHash(`${CACHE_KEY_VERSION}|${normalized}`);
}

const GEMINI_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24h

export async function getGeminiCachedResponse(
  rawOcr: string,
): Promise<string | null> {
  const key = hashOcrText(rawOcr);
  const row = await db.getFirstAsync<{ response_json: string; created_at: string }>(
    `SELECT response_json, created_at FROM gemini_cache WHERE text_hash=?`,
    [key],
  );
  if (!row) return null;
  const age = Date.now() - new Date(row.created_at).getTime();
  if (age > GEMINI_CACHE_TTL_MS) return null;
  return row.response_json;
}

export async function setGeminiCachedResponse(
  rawOcr: string,
  responseJson: string,
): Promise<void> {
  const key = hashOcrText(rawOcr);
  await db.runAsync(
    `INSERT INTO gemini_cache (text_hash, response_json, created_at)
     VALUES (?, ?, ?)
     ON CONFLICT(text_hash) DO UPDATE SET
       response_json = excluded.response_json,
       created_at    = excluded.created_at`,
    [key, responseJson, new Date().toISOString()],
  );
}

export async function saveCorrection(input: {
  storeName: string;
  rawOcr: string;
  items: import('../types').LineItem[];
}): Promise<void> {
  const uid = requireUserId('saveCorrection');
  const id = Math.random().toString(36).slice(2) + Date.now().toString(36);
  const storeKey = input.storeName.trim().toLowerCase();
  if (!storeKey) return;
  // Cap stored OCR at ~3KB — long enough to capture the items block,
  // short enough that we can comfortably inject into a prompt.
  const truncatedOcr = input.rawOcr.slice(0, 3000);
  const itemsJson = JSON.stringify(
    input.items.map((it) => ({
      name: it.name,
      amount: it.amount,
      category: it.category,
    })),
  );
  await db.withTransactionAsync(async () => {
    await db.runAsync(
      `INSERT INTO receipt_corrections (id, store_name, raw_ocr, items_json, created_at, user_id)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [id, storeKey, truncatedOcr, itemsJson, new Date().toISOString(), uid],
    );
    // Keep the table bounded — only the 10 most recent corrections per
    // store FOR THIS USER. A user with 100 stores ends up with at most
    // 1000 rows; multiplied across users this stays well under any
    // realistic device-storage concern.
    await db.runAsync(
      `DELETE FROM receipt_corrections
       WHERE store_name = ?
         AND user_id    = ?
         AND id NOT IN (
           SELECT id FROM receipt_corrections
           WHERE store_name = ?
             AND user_id    = ?
           ORDER BY created_at DESC
           LIMIT 10
         )`,
      [storeKey, uid, storeKey, uid],
    );
  });
}

export async function getRelevantCorrections(
  storeName: string,
  limit = 2,
): Promise<
  Array<{
    rawOcr: string;
    items: Array<{ name: string; amount: number; category?: string }>;
    createdAt: string;
  }>
> {
  const uid = requireUserId('getRelevantCorrections');
  const storeKey = storeName.trim().toLowerCase();
  if (!storeKey) return [];
  const rows = await db.getAllAsync<{
    raw_ocr: string;
    items_json: string;
    created_at: string;
  }>(
    `SELECT raw_ocr, items_json, created_at
     FROM receipt_corrections
     WHERE store_name = ?
       AND user_id    = ?
     ORDER BY created_at DESC
     LIMIT ?`,
    [storeKey, uid, limit],
  );
  const out: Array<{
    rawOcr: string;
    items: Array<{ name: string; amount: number; category?: string }>;
    createdAt: string;
  }> = [];
  for (const r of rows) {
    try {
      const items = JSON.parse(r.items_json);
      if (Array.isArray(items)) {
        out.push({ rawOcr: r.raw_ocr, items, createdAt: r.created_at });
      }
    } catch {
      // skip malformed rows
    }
  }
  return out;
}

export async function getCachedItemClassification(
  cleanedName: string,
): Promise<{ category: string; source: string } | null> {
  const row = await db.getFirstAsync<{ category: string; source: string }>(
    `SELECT category, source FROM item_classifications WHERE cleaned_name=?`,
    [cleanedName],
  );
  return row ?? null;
}

export async function setCachedItemClassification(
  cleanedName: string,
  category: string,
  source: 'local' | 'remote',
): Promise<void> {
  await db.runAsync(
    `INSERT INTO item_classifications (cleaned_name, category, source, created_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(cleaned_name) DO UPDATE SET
       category   = excluded.category,
       source     = excluded.source,
       created_at = excluded.created_at`,
    [cleanedName, category, source, new Date().toISOString()],
  );
}

export async function updateLineItemCategory(
  itemId: string,
  category: string,
): Promise<void> {
  const uid = requireUserId('updateLineItemCategory');
  // Defense-in-depth: only update items whose parent receipt belongs to
  // the current user. Prevents a stale item id (or a malicious caller)
  // from reaching across user boundaries.
  await db.runAsync(
    `UPDATE line_items
     SET category = ?
     WHERE id = ?
       AND receipt_id IN (SELECT id FROM receipts WHERE user_id = ?)`,
    [category, itemId, uid],
  );
}

/**
 * Replace the line items on a receipt without touching any of the
 * receipt's header fields. Used by the per-item edit modal on the
 * receipt detail screen so item changes are saved immediately
 * (without forcing the user to also tap Save Changes at the bottom).
 */
export async function replaceLineItems(
  receiptId: string,
  items: import('../types').LineItem[],
): Promise<void> {
  const uid = requireUserId('replaceLineItems');
  // Verify the receipt belongs to the current user before mutating
  // its line items. If a stale receipt id leaks from a previous user's
  // session (e.g. via React state that wasn't cleared), the lookup
  // returns no row and we leave the data alone.
  const ownedRow = await db.getFirstAsync<{ id: string }>(
    `SELECT id FROM receipts WHERE id = ? AND user_id = ?`,
    [receiptId, uid],
  );
  if (!ownedRow) return;
  const hid = currentHouseholdId;
  await db.withTransactionAsync(async () => {
    await db.runAsync(`DELETE FROM line_items WHERE receipt_id=?`, [receiptId]);
    for (const item of items) {
      await db.runAsync(
        `INSERT INTO line_items (id, receipt_id, name, amount, category, split_with) VALUES (?, ?, ?, ?, ?, ?)`,
        [item.id, receiptId, item.name, item.amount, item.category ?? null, serializeSplitWith(item.splitWith)],
      );
    }
    // Bump the receipt's updated_at so list views know to re-render.
    await db.runAsync(
      `UPDATE receipts SET updated_at=? WHERE id=? AND user_id=?`,
      [new Date().toISOString(), receiptId, uid],
    );
  });
  // Reload the full receipt and shadow-write — replaceLineItems is
  // called in isolation from the per-item edit modal, which doesn't
  // go through updateReceipt, so without this hook line-item edits
  // would only land locally.
  if (hid) {
    const fresh = await getReceiptById(receiptId).catch(() => null);
    if (fresh) void syncReceiptToCloud(fresh, hid);
  }
}

/**
 * Deletes every receipt belonging to the CURRENTLY SIGNED-IN user.
 * Used by the deleteAccount flow. Other users' data on the same
 * device is untouched.
 */
export async function deleteAllReceipts(): Promise<void> {
  const uid = requireUserId('deleteAllReceipts');
  await db.withTransactionAsync(async () => {
    // line_items cascade-delete via the FK once their parent receipts
    // are removed, but be explicit so we're not relying on PRAGMA
    // foreign_keys=ON being honoured by every SQLite build.
    await db.runAsync(
      `DELETE FROM line_items
       WHERE receipt_id IN (SELECT id FROM receipts WHERE user_id = ?)`,
      [uid],
    );
    await db.runAsync(`DELETE FROM receipts WHERE user_id = ?`, [uid]);
    await db.runAsync(`DELETE FROM receipt_corrections WHERE user_id = ?`, [uid]);
  });
}

export interface ProfileRow {
  uid: string;
  first_name: string;
  last_name: string;
  phone: string | null;
  phone_verified: number | null;
  created_at: string;
  updated_at: string;
}

export async function getProfileRow(uid: string): Promise<ProfileRow | null> {
  return (
    (await db.getFirstAsync<ProfileRow>(
      `SELECT uid, first_name, last_name, phone, phone_verified, created_at, updated_at FROM profiles WHERE uid=?`,
      [uid],
    )) ?? null
  );
}

export async function upsertProfileRow(row: ProfileRow): Promise<void> {
  await db.runAsync(
    `INSERT INTO profiles (uid, first_name, last_name, phone, phone_verified, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(uid) DO UPDATE SET
       first_name     = excluded.first_name,
       last_name      = excluded.last_name,
       phone          = excluded.phone,
       phone_verified = excluded.phone_verified,
       updated_at     = excluded.updated_at`,
    [
      row.uid,
      row.first_name,
      row.last_name,
      row.phone,
      row.phone_verified,
      row.created_at,
      row.updated_at,
    ],
  );
}

export async function deleteProfileRow(uid: string): Promise<void> {
  await db.runAsync(`DELETE FROM profiles WHERE uid=?`, [uid]);
}

export async function saveReceipt(receipt: Receipt): Promise<void> {
  const uid = requireUserId('saveReceipt');
  const tagsJson = serializeTags(receipt.categoryTags);
  // Cloud shadow-write fires AFTER the local commit succeeds. We
  // capture the receipt + household id outside the transaction so
  // the post-commit hook doesn't depend on any in-transaction state.
  const hid = currentHouseholdId;
  await db.withTransactionAsync(async () => {
    await db.runAsync(
      `INSERT INTO receipts
         (id, store_name, date, total_amount, subtotal_amount, tax_amount,
          category, category_tags, raw_text, image_uri, photo_url, notes,
          split_json, recurring_json, original_currency, paid_by, created_at, updated_at, user_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        receipt.id,
        receipt.storeName,
        receipt.date,
        receipt.totalAmount,
        receipt.subtotalAmount ?? null,
        receipt.taxAmount ?? null,
        receipt.category,
        tagsJson,
        receipt.rawText ?? null,
        receipt.imageUri ?? null,
        receipt.photoUrl ?? null,
        receipt.notes ?? null,
        serializeSplit(receipt.split),
        serializeRecurring(receipt.recurring),
        receipt.originalCurrency ?? null,
        receipt.paidBy ?? uid,
        receipt.createdAt,
        receipt.updatedAt,
        uid,
      ],
    );

    for (const item of receipt.lineItems ?? []) {
      await db.runAsync(
        `INSERT INTO line_items (id, receipt_id, name, amount, category, split_with) VALUES (?, ?, ?, ?, ?, ?)`,
        [item.id, receipt.id, item.name, item.amount, item.category ?? null, serializeSplitWith(item.splitWith)],
      );
    }
  });
  // Shadow-write to Firestore once the local commit is durable. Fire-
  // and-forget — failure here is logged, not surfaced (local already
  // succeeded, sync will retry on the next update or via the explicit
  // re-sync helpers).
  if (hid) {
    void syncReceiptToCloud(receipt, hid);
  }
}

export async function updateReceipt(receipt: Receipt): Promise<void> {
  const uid = requireUserId('updateReceipt');
  const hid = currentHouseholdId;
  // Stamp ONE fresh timestamp used for both the local row and the
  // cloud shadow-write below — callers (e.g. app/edit/[id].tsx's
  // handleSave) spread the OLD loaded `receipt` object without bumping
  // `updatedAt` themselves, so `receipt.updatedAt` here is stale. Cloud
  // sync used to serialize that stale value straight to Firestore,
  // which combined with upsertReceiptFromCloud's "skip if local is
  // already at least as fresh" guard meant another household member's
  // device could silently ignore a real, newer edit — exactly what
  // made a re-saved split still not show up cross-device.
  const now = new Date().toISOString();
  await db.withTransactionAsync(async () => {
    await db.runAsync(
      `UPDATE receipts
       SET store_name=?, date=?, total_amount=?, subtotal_amount=?, tax_amount=?,
           category=?, category_tags=?, notes=?, split_json=?, recurring_json=?,
           original_currency=?, paid_by=?, updated_at=?
       WHERE id=? AND user_id=?`,
      [
        receipt.storeName,
        receipt.date,
        receipt.totalAmount,
        receipt.subtotalAmount ?? null,
        receipt.taxAmount ?? null,
        receipt.category,
        serializeTags(receipt.categoryTags),
        receipt.notes ?? null,
        serializeSplit(receipt.split),
        serializeRecurring(receipt.recurring),
        receipt.originalCurrency ?? null,
        receipt.paidBy ?? uid,
        now,
        receipt.id,
        uid,
      ],
    );

    // Replace line items if the caller provided a new list. Caller can
    // omit `lineItems` to leave them unchanged (the previous behavior
    // that the dashboard relied on for non-item edits). Scope the
    // delete via the receipts table so a stale id from another user's
    // session can never wipe their items.
    if (receipt.lineItems !== undefined) {
      await db.runAsync(
        `DELETE FROM line_items
         WHERE receipt_id = ?
           AND receipt_id IN (SELECT id FROM receipts WHERE user_id = ?)`,
        [receipt.id, uid],
      );
      for (const item of receipt.lineItems) {
        await db.runAsync(
          `INSERT INTO line_items (id, receipt_id, name, amount, category, split_with) VALUES (?, ?, ?, ?, ?, ?)`,
          [item.id, receipt.id, item.name, item.amount, item.category ?? null, serializeSplitWith(item.splitWith)],
        );
      }
    }
  });
  // Mirror the updated state to Firestore. We resync the WHOLE
  // receipt (not a delta) so the cloud doc always matches what's on
  // the device — simpler reasoning, and the doc payload is tiny.
  // Pass `now`, not the caller's possibly-stale `receipt.updatedAt` —
  // see the comment above.
  if (hid) {
    void syncReceiptToCloud({ ...receipt, updatedAt: now }, hid);
  }
}

function serializeTags(tags: string[] | undefined): string | null {
  if (!tags || tags.length === 0) return null;
  return JSON.stringify(tags);
}

function serializeSplitWith(ids: string[] | undefined): string | null {
  if (!ids || ids.length === 0) return null;
  return JSON.stringify(ids);
}

function parseSplitWith(raw: string | null): string[] | undefined {
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.every((v) => typeof v === 'string')
      ? parsed
      : undefined;
  } catch {
    return undefined;
  }
}

function serializeRecurring(recurring: Receipt['recurring'] | undefined): string | null {
  if (!recurring) return null;
  return JSON.stringify(recurring);
}

function parseRecurring(raw: string | null): Receipt['recurring'] | undefined {
  if (!raw) return undefined;
  try {
    return JSON.parse(raw) as Receipt['recurring'];
  } catch {
    return undefined;
  }
}

function serializeSplit(split: Receipt['split'] | undefined): string | null {
  if (!split) return null;
  return JSON.stringify(split);
}

function parseSplit(raw: string | null): Receipt['split'] | undefined {
  if (!raw) return undefined;
  try {
    return JSON.parse(raw) as Receipt['split'];
  } catch {
    return undefined;
  }
}

function parseTags(raw: string | null, fallbackCategory: string): string[] {
  if (!raw) return [fallbackCategory];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.every((t) => typeof t === 'string')) {
      return parsed.length ? parsed : [fallbackCategory];
    }
  } catch {
    // fall through
  }
  return [fallbackCategory];
}

export async function deleteReceipt(id: string): Promise<void> {
  const uid = requireUserId('deleteReceipt');
  const hid = currentHouseholdId;
  await db.runAsync(`DELETE FROM receipts WHERE id=? AND user_id=?`, [id, uid]);
  if (hid) {
    void syncReceiptDeletionToCloud(id, hid);
  }
}

export async function getAllReceipts(): Promise<Receipt[]> {
  const uid = requireUserId('getAllReceipts');
  const rows = await db.getAllAsync<RawRow>(
    `SELECT * FROM receipts WHERE user_id=? ORDER BY date DESC`,
    [uid],
  );
  return await attachLineItems(rows);
}

export async function getReceiptById(id: string): Promise<Receipt | null> {
  const uid = requireUserId('getReceiptById');
  const row = await db.getFirstAsync<RawRow>(
    `SELECT * FROM receipts WHERE id=? AND user_id=?`,
    [id, uid],
  );
  if (!row) return null;
  const [withItems] = await attachLineItems([row]);
  return withItems ?? rowToReceipt(row);
}

export async function getReceiptsByMonth(year: number, month: number): Promise<Receipt[]> {
  const uid = requireUserId('getReceiptsByMonth');
  const start = new Date(year, month - 1, 1).toISOString();
  const end   = new Date(year, month, 0, 23, 59, 59).toISOString();
  const rows  = await db.getAllAsync<RawRow>(
    `SELECT * FROM receipts
     WHERE user_id = ? AND date >= ? AND date <= ?
     ORDER BY date DESC`,
    [uid, start, end],
  );
  return await attachLineItems(rows);
}

export async function searchReceipts(query: string): Promise<Receipt[]> {
  const uid = requireUserId('searchReceipts');
  const q = `%${query.toLowerCase()}%`;
  const rows = await db.getAllAsync<RawRow>(
    `SELECT * FROM receipts
     WHERE user_id = ?
       AND (lower(store_name) LIKE ? OR lower(category) LIKE ? OR lower(notes) LIKE ?)
     ORDER BY date DESC`,
    [uid, q, q, q],
  );
  return await attachLineItems(rows);
}

/**
 * Batch-load line items for a list of receipt rows in a single query and
 * attach them to the resulting Receipt objects. Used by every receipt-list
 * query so the dashboard's per-category aggregation has the items it needs.
 */
async function attachLineItems(rows: RawRow[]): Promise<Receipt[]> {
  if (rows.length === 0) return [];
  const placeholders = rows.map(() => '?').join(',');
  const itemRows = await db.getAllAsync<{
    id: string;
    receipt_id: string;
    name: string;
    amount: number;
    category: string | null;
    split_with: string | null;
  }>(
    `SELECT id, receipt_id, name, amount, category, split_with
     FROM line_items WHERE receipt_id IN (${placeholders})`,
    rows.map((r) => r.id),
  );
  const byReceiptId = new Map<string, Receipt['lineItems']>();
  for (const r of itemRows) {
    const list = byReceiptId.get(r.receipt_id) ?? [];
    list.push({
      id: r.id,
      name: r.name,
      amount: r.amount,
      // Default to 'Other' when the DB row has a null/empty category —
      // covers legacy items written before per-item categorization and
      // any AI/regex result that slipped through without a category.
      // Downstream code (dashboard, drilldown, edit) can always rely on
      // a non-empty category string.
      category:
        r.category && r.category.trim() ? r.category : 'Other',
      splitWith: parseSplitWith(r.split_with),
    });
    byReceiptId.set(r.receipt_id, list);
  }
  return rows.map((row) => ({
    ...rowToReceipt(row),
    lineItems: byReceiptId.get(row.id) ?? [],
  }));
}

// ─── helpers ────────────────────────────────────────────────────────────────

interface RawRow {
  id: string;
  store_name: string;
  date: string;
  total_amount: number;
  subtotal_amount: number | null;
  tax_amount: number | null;
  category: string;
  category_tags: string | null;
  raw_text: string | null;
  image_uri: string | null;
  photo_url: string | null;
  notes: string | null;
  split_json: string | null;
  recurring_json: string | null;
  original_currency: string | null;
  paid_by: string | null;
  created_at: string;
  updated_at: string;
}

function rowToReceipt(row: RawRow): Receipt {
  return {
    id: row.id,
    storeName: row.store_name,
    date: row.date,
    totalAmount: row.total_amount,
    subtotalAmount: row.subtotal_amount ?? undefined,
    taxAmount: row.tax_amount ?? undefined,
    category: row.category as Receipt['category'],
    categoryTags: parseTags(row.category_tags, row.category),
    rawText: row.raw_text ?? undefined,
    imageUri: row.image_uri ?? undefined,
    photoUrl: row.photo_url ?? undefined,
    notes: row.notes ?? undefined,
    originalCurrency: (row.original_currency as Receipt['originalCurrency']) ?? undefined,
    split: parseSplit(row.split_json),
    recurring: parseRecurring(row.recurring_json),
    paidBy: row.paid_by ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Persist a successful Cloud Storage upload URL back into the local
 * row. Called by cloudSync.syncReceiptToCloud after uploadReceiptPhoto
 * succeeds, so the next save on this receipt sees photoUrl set and
 * skips the re-upload.
 */
export async function setReceiptPhotoUrl(
  receiptId: string,
  photoUrl: string,
): Promise<void> {
  const uid = requireUserId('setReceiptPhotoUrl');
  await db.runAsync(
    `UPDATE receipts SET photo_url=? WHERE id=? AND user_id=?`,
    [photoUrl, receiptId, uid],
  );
}

// ─── cloud→local mirror helpers (Phase 3 listener) ───────────────────────
//
// Called by lib/cloudSync.ts's receipts subscription whenever Firestore
// reports a change from any device in the household. These paths are
// LOCAL-ONLY — they intentionally do NOT trigger the shadow-write back to
// cloud, since the data is ALREADY in cloud (that's what we just saw).
// Doing so would create an idle write-amplification loop and make the
// SQLite row's updated_at march forward on every snapshot for no reason.

type CloudReceiptShape = {
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
  split?: Receipt['split'];
  recurring?: Receipt['recurring'];
  paidBy?: string | null;
  lineItems?: Array<{
    id: string;
    name: string;
    amount: number;
    category?: string | null;
    splitWith?: string[];
  }>;
  createdAt: string;
  updatedAt: string;
};

export async function upsertReceiptFromCloud(
  cloud: CloudReceiptShape,
  uid: string,
): Promise<void> {
  // We accept uid explicitly because the listener fires regardless of
  // currentUserId — e.g. it might still be processing a snapshot batch
  // mid-sign-out. The uid is stamped from whichever household member
  // wrote the doc, which is fine because every member shares the row.

  // Guard against a STALE cloud snapshot clobbering a newer local edit.
  // syncReceiptToCloud (in cloudSync.ts) is fire-and-forget — if the app
  // gets killed (e.g. for a rebuild) right after a local save but
  // before that write reaches Firestore, the cloud doc is left behind
  // with the OLD data. subscribeToHouseholdReceipts does a full resync
  // on every fresh app launch, and without this check that stale
  // snapshot would silently overwrite the correct local row — this is
  // almost certainly why toggling "Split this expense" appeared to
  // reset after rebuilding: the split write hadn't reached the cloud
  // yet when the app was killed for the rebuild. Skip the whole upsert
  // if the local row is already at least as fresh.
  const existing = await db.getFirstAsync<{ updated_at: string }>(
    `SELECT updated_at FROM receipts WHERE id=?`,
    [cloud.id],
  );
  if (existing && existing.updated_at >= cloud.updatedAt) {
    return;
  }

  const tagsJson = cloud.categoryTags
    ? JSON.stringify(cloud.categoryTags)
    : null;
  await db.withTransactionAsync(async () => {
    await db.runAsync(
      `INSERT INTO receipts
         (id, store_name, date, total_amount, subtotal_amount, tax_amount,
          category, category_tags, raw_text, image_uri, photo_url, notes,
          split_json, recurring_json, paid_by, created_at, updated_at, user_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         store_name      = excluded.store_name,
         date            = excluded.date,
         total_amount    = excluded.total_amount,
         subtotal_amount = excluded.subtotal_amount,
         tax_amount      = excluded.tax_amount,
         category        = excluded.category,
         category_tags   = excluded.category_tags,
         raw_text        = excluded.raw_text,
         image_uri       = excluded.image_uri,
         photo_url       = excluded.photo_url,
         notes           = excluded.notes,
         split_json      = excluded.split_json,
         recurring_json  = excluded.recurring_json,
         paid_by         = excluded.paid_by,
         updated_at      = excluded.updated_at,
         user_id         = excluded.user_id`,
      [
        cloud.id,
        cloud.storeName,
        cloud.date,
        cloud.totalAmount,
        cloud.subtotalAmount ?? null,
        cloud.taxAmount ?? null,
        cloud.category,
        tagsJson,
        cloud.rawText ?? null,
        cloud.imageUri ?? null,
        cloud.photoUrl ?? null,
        cloud.notes ?? null,
        serializeSplit(cloud.split),
        serializeRecurring(cloud.recurring),
        cloud.paidBy ?? null,
        cloud.createdAt,
        cloud.updatedAt,
        uid,
      ],
    );
    // Wipe + re-insert line items so the local set always matches the
    // cloud doc exactly. Simpler than diffing — and the row count per
    // receipt is small (typically <30).
    await db.runAsync(`DELETE FROM line_items WHERE receipt_id = ?`, [cloud.id]);
    for (const it of cloud.lineItems ?? []) {
      await db.runAsync(
        `INSERT INTO line_items (id, receipt_id, name, amount, category, split_with) VALUES (?, ?, ?, ?, ?, ?)`,
        [it.id, cloud.id, it.name, it.amount, it.category ?? null, serializeSplitWith(it.splitWith)],
      );
    }
  });
}

export async function deleteReceiptLocally(
  receiptId: string,
  uid: string,
): Promise<void> {
  // Scope the delete by uid so a malformed listener payload can't wipe
  // another user's receipt on this same device.
  await db.runAsync(`DELETE FROM receipts WHERE id=? AND user_id=?`, [
    receiptId,
    uid,
  ]);
}
