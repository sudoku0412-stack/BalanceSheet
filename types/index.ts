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
  lineItems?: LineItem[];
  /** Splitwise-style split state. Absent/enabled=false means the expense
   *  isn't split. Participant ids are 'self' (the signed-in user, always
   *  included) plus household member uids from cloudSync.getHouseholdMembers. */
  split?: {
    enabled: boolean;
    method: 'equal' | 'percent' | 'amount';
    participantIds: string[];
    /** Per-participant % (method='percent') or $ amount (method='amount'). Keyed by participantId. */
    values?: Record<string, number>;
  };
  createdAt: string;
  updatedAt: string;
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
