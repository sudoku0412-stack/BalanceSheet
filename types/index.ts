import { CurrencyCode } from '../lib/currency';

export type Category =
  | 'Groceries'
  | 'Electronics'
  | 'Dining'
  | 'Pharmacy'
  | 'Gas'
  | 'Clothing'
  | 'Entertainment'
  | 'Travel'
  | 'Healthcare'
  | 'Electricity'
  | 'Recurring'
  | 'Other';

export interface LineItem {
  id: string;
  name: string;
  amount: number;
  /** Per-item category. Either one of the standard `Category` values
   *  or a custom user-defined tag (e.g. "Gym", "Pet Food") that the
   *  parent receipt was tagged with. Older line items written before
   *  per-item categorization may be undefined; treat as the receipt's
   *  overall category in that case. */
  category?: Category | string;
  /** Household member ids (uid, or 'self' for the signed-in user) this
   *  item is shared with, split equally among them. Undefined/empty
   *  means "everyone in the receipt's split" (the default). Only
   *  meaningful when the parent receipt's `split.enabled` is true. */
  splitWith?: string[];
}

export interface Receipt {
  id: string;
  storeName: string;
  date: string;
  totalAmount: number;
  /** Sum before tax. Optional — older receipts didn't capture this. */
  subtotalAmount?: number;
  /** Tax (HST/GST/VAT/sales tax) extracted from the receipt. Optional. */
  taxAmount?: number;
  /** Primary category — the dominant tag, used by the dashboard for
   *  aggregation. Always one of the standard 10 enum values. */
  category: Category;
  /** Multi-select tags for this receipt. Includes the standard category
   *  values AND any custom user / AI-suggested tags ("Pet Food", "Home
   *  Decor", etc.). Old rows fall back to [category] at read time. */
  categoryTags?: string[];
  rawText?: string;
  imageUri?: string;
  /** Phase 2: cloud-hosted copy of the receipt photo. Populated by
   *  cloudSync.uploadReceiptPhoto on save; consumed by other devices
   *  in the same household (Phase 3). Same image, different home —
   *  imageUri stays the path on THIS device, photoUrl is the shared
   *  Cloud Storage URL. */
  photoUrl?: string;
  notes?: string;
  /** Currency this receipt was actually entered/scanned in — may differ
   *  from the user's profile currency (e.g. a USD purchase while the
   *  profile is set to CAD). `totalAmount`/`subtotalAmount`/`taxAmount`/
   *  line-item amounts are always converted to USD-canonical at save
   *  time regardless; this is purely what to convert back to when
   *  re-editing, so the amount shown matches what was actually typed
   *  rather than snapping to whatever the profile currency is NOW.
   *  Absent on legacy receipts — treat as the profile currency. */
  originalCurrency?: CurrencyCode;
  lineItems?: LineItem[];
  /** Splitwise-style split state. Absent/enabled=false means the expense
   *  isn't split. Participant ids are 'self' (the signed-in user, always
   *  included) plus household member uids from cloudSync.getHouseholdMembers. */
  split?: {
    enabled: boolean;
    method: 'equal' | 'percent' | 'amount' | 'shares';
    participantIds: string[];
    /** Per-participant % (method='percent'), $ amount (method='amount'),
     *  or share count (method='shares', Splitwise-style — e.g. 2 shares
     *  vs. 1 share splits the total 2:1). Keyed by participantId. */
    values?: Record<string, number>;
  };
  /** Who actually fronted the money for this receipt — a real Firebase
   *  uid (never the 'self' placeholder split.participantIds uses, since
   *  this needs to resolve to the same person from every household
   *  member's device for lib/balances.ts to compute correctly). Defaults
   *  to the creator's uid at save time; overridable via the split UI.
   *  Absent on receipts saved before this field existed — lib/balances.ts
   *  falls back to "creator paid" for those. */
  paidBy?: string;
  /** Which household member this expense belongs to — set once, to the
   *  creator's uid, when the receipt is first saved, and never changed
   *  by later edits (even from another member's device). Lets
   *  lib/balances.ts settle a receipt that ISN'T split (`split.enabled`
   *  false/absent) but was still fronted by someone else: the full
   *  amount is owed by `createdBy` to `paidBy`, the same way Splitwise
   *  separates "who paid" from "whose expense this is." Absent on
   *  receipts saved before this field existed — those keep the old
   *  behavior (no cross-member balance impact unless split is enabled). */
  createdBy?: string;
  /** Auto-repeat config. When set, `lib/recurring.ts`'s processor
   *  clones this receipt onto new dated rows on a schedule until
   *  `endDate`, then stops. Absent means this expense is one-off. */
  recurring?: {
    frequency: 'weekly' | 'biweekly' | 'monthly' | 'yearly';
    /** ISO date (YYYY-MM-DD) of the next occurrence still to generate. */
    nextDueDate: string;
    /** ISO date (YYYY-MM-DD) after which auto-add stops — derived once
     *  at creation time from the user's chosen duration. */
    endDate: string;
  };
  /** True for a receipt materialized by lib/recurring.ts's
   *  processRecurringReceipts from an active recurring template —
   *  distinct from `recurring` itself (only the ORIGINAL template
   *  carries the schedule forward; generated occurrences are plain
   *  receipts except for this flag). Used to track the "Recurring"
   *  pseudo-category budget in Settings/Home regardless of the
   *  receipt's own category. */
  isRecurringOccurrence?: boolean;
  /** Which household this receipt belongs to on THIS device's local
   *  SQLite store (multi-household support). Populated when read out
   *  of the DB (`rowToReceipt`); not part of the Firestore payload —
   *  the household is already the partition there
   *  (`households/{hid}/receipts/{rid}`), so writing it again into the
   *  doc body would be redundant. */
  householdId?: string;
  createdAt: string;
  updatedAt: string;
}

/** A payment recorded to reduce a balance between two household members
 *  — Splitwise-style "settle up". Purely a ledger entry: it's never a
 *  Receipt, never touches `totalAmount`/reports, and only nets out the
 *  fromUid<->toUid pair in lib/balances.ts. All amounts USD-canonical,
 *  same as Receipt. */
export interface Settlement {
  id: string;
  /** Who paid — settling what THEY owe. */
  fromUid: string;
  /** Who received the payment. */
  toUid: string;
  amountUsd: number;
  createdAt: string;
  /** Same local-only, not-serialized-to-Firestore purpose as
   *  `Receipt.householdId` above. */
  householdId?: string;
}

export interface ParsedReceipt {
  storeName: string;
  date: string;
  totalAmount: number;
  subtotalAmount?: number;
  taxAmount?: number;
  category: Category;
  categoryTags?: string[];
  lineItems: LineItem[];
  rawText: string;
}

export interface CategorySummary {
  category: Category | string;
  total: number;
  count: number;
  percentage: number;
}

export interface MonthlyStats {
  totalSpent: number;
  receiptCount: number;
  topCategory: Category | string | null;
  avgPerReceipt: number;
  categories: CategorySummary[];
}
