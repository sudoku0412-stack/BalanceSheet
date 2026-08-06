/**
 * Tiny pub/sub so screens can react when a Firestore listener
 * (subscribeToHouseholdReceipts/Settlements/Budgets in cloudSync.ts)
 * writes fresh data into local SQLite/SecureStore.
 *
 * Without this, a screen's own `load()` only ever re-reads local storage
 * on navigation focus or an AppState resume — neither of which is tied to
 * when the cloud data actually landed. That's a real race on notification
 * taps: the app resumes and reloads immediately, often before the
 * Firestore listener (reconnecting after being backgrounded) has
 * delivered its update, so the reload reads stale rows. It also means a
 * change from another household member never appears while a screen is
 * sitting open in the foreground. This closes both gaps by having the
 * listeners announce "local data changed" and letting screens reload
 * exactly when that happens.
 */
type Listener = () => void;

const listeners = new Set<Listener>();

export function onLocalDataChanged(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function notifyLocalDataChanged(): void {
  for (const listener of listeners) listener();
}
