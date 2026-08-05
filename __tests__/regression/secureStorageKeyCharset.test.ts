/**
 * Regression test — "expo-secure-store keys with colons" (lib/secureStorage.ts).
 *
 * Original failure mode: expo-secure-store only accepts keys matching
 * `[A-Za-z0-9._-]+` — no colons. Namespaced keys (budgets-per-household,
 * cloudMigrationDone-per-user, etc.) originally used a `:` separator
 * (e.g. `bs.budgets.byCategory:abc123`), which threw "Invalid key
 * provided to SecureStore" the moment a real id got interpolated in.
 * Fixed by switching every namespaced key to a `.` separator.
 *
 * This test spies on the mocked expo-secure-store module and asserts
 * every key this module ever constructs — across multiple household ids
 * and uids, including ones that could plausibly contain characters other
 * modules use as separators — contains no colon and matches the allowed
 * charset. Against the original `:`-based code this would fail
 * immediately on the first namespaced call.
 */
import * as SecureStore from 'expo-secure-store';

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => undefined),
  deleteItemAsync: jest.fn(async () => undefined),
}));

import {
  getCloudMigrationDone,
  setCloudMigrationDone,
  getCategoryBudgets,
  setCategoryBudget,
  getBudgetAlertsEnabled,
  setBudgetAlertsEnabled,
  getLastBudgetAlertDate,
  setLastBudgetAlertDate,
  migrateLegacyBudgetsToHousehold,
  clearBudgetsForHousehold,
} from '../../lib/secureStorage';

const ALLOWED_KEY_RE = /^[A-Za-z0-9._-]+$/;

function collectAllKeysUsed(): string[] {
  const getSpy = SecureStore.getItemAsync as jest.Mock;
  const setSpy = SecureStore.setItemAsync as jest.Mock;
  const delSpy = SecureStore.deleteItemAsync as jest.Mock;
  const keys: string[] = [
    ...getSpy.mock.calls.map((c) => c[0]),
    ...setSpy.mock.calls.map((c) => c[0]),
    ...delSpy.mock.calls.map((c) => c[0]),
  ];
  return keys;
}

describe('Regression: SecureStore key charset (lib/secureStorage.ts)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('never constructs a key containing a colon, across multiple household/user ids', async () => {
    const householdIds = ['household-1', 'household-2', 'hh_with_underscore'];
    const uids = ['uid-1', 'uid-2'];

    for (const uid of uids) {
      await getCloudMigrationDone(uid);
      await setCloudMigrationDone(uid);
    }

    for (const hid of householdIds) {
      await migrateLegacyBudgetsToHousehold(hid);
      await getCategoryBudgets(hid);
      await setCategoryBudget(hid, 'Groceries', 100);
      await getBudgetAlertsEnabled(hid);
      await setBudgetAlertsEnabled(hid, true);
      await getLastBudgetAlertDate(hid);
      await setLastBudgetAlertDate(hid, '2026-08-04');
      await clearBudgetsForHousehold(hid);
    }

    const allKeys = collectAllKeysUsed();
    expect(allKeys.length).toBeGreaterThan(0);

    for (const key of allKeys) {
      expect(key).not.toContain(':');
      expect(key).toMatch(ALLOWED_KEY_RE);
    }
  });

  it('namespaces the same key prefix distinctly per household id (no collision)', async () => {
    await setCategoryBudget('household-A', 'Groceries', 50);
    await setCategoryBudget('household-B', 'Groceries', 999);

    const setSpy = SecureStore.setItemAsync as jest.Mock;
    const keysForA = setSpy.mock.calls
      .map((c) => c[0] as string)
      .filter((k) => k.includes('household-A'));
    const keysForB = setSpy.mock.calls
      .map((c) => c[0] as string)
      .filter((k) => k.includes('household-B'));

    expect(keysForA.length).toBeGreaterThan(0);
    expect(keysForB.length).toBeGreaterThan(0);
    expect(keysForA).not.toEqual(keysForB);
  });
});
