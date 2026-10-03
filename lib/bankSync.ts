import Constants from 'expo-constants';
import * as SecureStore from 'expo-secure-store';
import { v4 as uuidv4 } from 'uuid';
import { getCurrentUser } from './auth';
import {
  addToReviewQueue,
  deleteReceipt,
  getReceiptByBankTxnId,
  saveReceipt,
  updateReceipt,
} from './database';
import { bankTransactionToReceipt, shouldImportTransaction, type BankTransaction } from './bankImport';
import type { CurrencyCode } from './currency';

const PENDING_LINK_KEY = 'bs.bank.pendingLink';

export class BankSyncError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

/** URL of the deployed bank-sync Worker (EXPO_PUBLIC / app.config extra
 *  `bankSyncEndpoint`), or null when this build has none configured. */
export function getBankSyncEndpoint(): string | null {
  const extra = (Constants.expoConfig?.extra ?? {}) as { bankSyncEndpoint?: string };
  const url = extra.bankSyncEndpoint?.trim();
  return url ? url.replace(/\/+$/, '') : null;
}

export const isBankSyncConfigured = (): boolean => getBankSyncEndpoint() !== null;

async function request<T>(path: string, method: 'GET' | 'POST', body?: unknown): Promise<T> {
  const base = getBankSyncEndpoint();
  if (!base) throw new BankSyncError('not-configured', 'Bank connections are not set up in this build.');
  const user = getCurrentUser();
  if (!user) throw new BankSyncError('signed-out', 'Sign in first.');
  const idToken = await user.getIdToken();
  const resp = await fetch(`${base}${path}`, {
    method,
    headers: { Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = (await resp.json().catch(() => ({}))) as Record<string, unknown>;
  if (!resp.ok) {
    throw new BankSyncError(String(data.error ?? `http-${resp.status}`), String(data.message ?? 'Request failed'));
  }
  return data as T;
}

export interface BankItem {
  itemId: string;
  institution: string;
  linkedAt?: string;
}

export function startBankLink(language: 'en' | 'fr') {
  return request<{ linkToken: string; url: string }>('/v1/link', 'POST', { language });
}

export function completeBankLink(linkToken: string) {
  return request<{ connected: BankItem[]; pending: boolean }>('/v1/complete', 'POST', { linkToken });
}

export async function listBankItems(): Promise<BankItem[]> {
  return (await request<{ items: BankItem[] }>('/v1/items', 'GET')).items;
}

export function removeBankItem(itemId: string) {
  return request<{ ok: boolean }>('/v1/remove', 'POST', { itemId });
}

// The link token of a connection the user started but we have not finished
// confirming (they are in the browser, or just came back).
export async function getPendingLinkToken(): Promise<string | null> {
  return SecureStore.getItemAsync(PENDING_LINK_KEY);
}
export async function setPendingLinkToken(token: string): Promise<void> {
  await SecureStore.setItemAsync(PENDING_LINK_KEY, token);
}
export async function clearPendingLinkToken(): Promise<void> {
  await SecureStore.deleteItemAsync(PENDING_LINK_KEY);
}

interface SyncItem {
  itemId: string;
  institution: string;
  added: BankTransaction[];
  modified: BankTransaction[];
  removed: string[];
  nextCursor: string | null;
  notReady?: boolean;
}

export interface BankSyncSummary {
  imported: number;
  updated: number;
  removed: number;
  /** Connections whose history Plaid is still preparing; try again shortly. */
  notReady: number;
}

/** A receipt the user has not touched since import (safe to adjust/remove). */
const untouched = (r: { createdAt: string; updatedAt: string }) => r.updatedAt === r.createdAt;

/**
 * Pulls new/changed/removed transactions from every connected bank and
 * applies them: new expenses land in the Review inbox, unedited imports
 * follow later changes, and imports you already edited are left alone.
 * Each connection's cursor is acknowledged to the server only after its
 * changes were saved, so a failure just retries (imports are de-duplicated
 * by transaction id).
 */
export async function syncBankTransactions(profileCurrency: CurrencyCode): Promise<BankSyncSummary> {
  const { items } = await request<{ items: SyncItem[] }>('/v1/sync', 'POST', {});
  const summary: BankSyncSummary = { imported: 0, updated: 0, removed: 0, notReady: 0 };
  const cursors: Record<string, string> = {};

  for (const item of items) {
    if (item.notReady) {
      summary.notReady += 1;
      continue;
    }
    try {
      const now = () => new Date().toISOString();

      const importNew = async (t: BankTransaction) => {
        if (!shouldImportTransaction(t)) return false;
        if (await getReceiptByBankTxnId(t.transaction_id)) return false;
        const receipt = bankTransactionToReceipt(t, profileCurrency, uuidv4(), now());
        await saveReceipt(receipt);
        await addToReviewQueue(receipt.id).catch(() => {});
        return true;
      };

      for (const t of item.added) if (await importNew(t)) summary.imported += 1;

      for (const t of item.modified) {
        const existing = await getReceiptByBankTxnId(t.transaction_id);
        if (!existing) {
          if (await importNew(t)) summary.imported += 1;
        } else if (untouched(existing) && shouldImportTransaction(t)) {
          const fresh = bankTransactionToReceipt(t, profileCurrency, existing.id, existing.createdAt);
          await updateReceipt({ ...existing, ...fresh, createdAt: existing.createdAt });
          summary.updated += 1;
        }
      }

      for (const id of item.removed) {
        const existing = await getReceiptByBankTxnId(id);
        if (existing && untouched(existing)) {
          await deleteReceipt(existing.id);
          summary.removed += 1;
        }
      }

      if (item.nextCursor) cursors[item.itemId] = item.nextCursor;
    } catch {
      // leave this connection's cursor unacknowledged; the next sync retries
    }
  }

  if (Object.keys(cursors).length > 0) {
    await request('/v1/ack', 'POST', { cursors });
  }
  return summary;
}
