/**
 * Regression tests for "Fix Households nav guard bounce-back and
 * self-heal budget migration race" (commit ff6e535).
 */
import * as fs from 'fs';
import * as path from 'path';

describe('Regression: Households route whitelisted in the nav guard (app/_layout.tsx)', () => {
  /**
   * Bug: app/_layout.tsx's STICKY_VOLUNTARY whitelist (routes the auth
   * guard leaves alone when it resolves the target to '(tabs)') didn't
   * include the new 'households' route. Visiting Households immediately
   * bounced the user back to Home because the guard's effect saw
   * current='households', target='(tabs)', not in the whitelist, and
   * force-redirected.
   *
   * A full render of app/_layout.tsx pulls in the entire provider tree
   * (fonts, auth, every screen) which is impractical to mount in a unit
   * test; instead this pins the literal whitelist contents by source
   * inspection — a tight, direct check that 'households' is (and stays)
   * in STICKY_VOLUNTARY, and that the route is actually registered as a
   * Stack.Screen. Removing 'households' from the set, exactly the
   * original bug, would fail this test.
   */
  it('STICKY_VOLUNTARY includes "households" and the route is registered', () => {
    const source = fs.readFileSync(
      path.join(__dirname, '../../app/_layout.tsx'),
      'utf8',
    );

    const whitelistMatch = source.match(/STICKY_VOLUNTARY\s*=\s*new Set\(\[([^\]]*)\]\)/);
    expect(whitelistMatch).not.toBeNull();
    const whitelistItems = whitelistMatch![1]
      .split(',')
      .map((s) => s.trim().replace(/^['"]|['"]$/g, ''))
      .filter(Boolean);

    expect(whitelistItems).toContain('households');
    expect(source).toMatch(/name="households"/);
  });
});

describe('Regression: budget-legacy-migration self-heals without depending on AuthContext sign-in ordering (lib/secureStorage.ts)', () => {
  /**
   * Bug: the one-time copy of the legacy flat budgets key into a
   * household-namespaced key only ran via AuthContext's fire-and-forget
   * call during sign-in. Reading budgets (getCategoryBudgets /
   * getBudgetAlertsEnabled) before that call resolved — or if it ever
   * silently failed — permanently surfaced the namespaced key as empty,
   * which read to the user as "my budgets got wiped," even though the
   * legacy key still held everything.
   *
   * Fixed by running the migration inline as a side effect of the very
   * first read (getCategoryBudgets/getBudgetAlertsEnabled call
   * migrateLegacyBudgetsToHousehold themselves) instead of depending on
   * a separate caller to have already done it.
   *
   * This test seeds ONLY the legacy flat key (simulating AuthContext's
   * migration call never having run/resolved yet) and calls
   * getCategoryBudgets directly for a brand-new household id — asserts
   * the legacy data is still visible, proving the read path self-heals.
   */
  it('getCategoryBudgets surfaces legacy data even when no separate migration call ran first', async () => {
    const mockSecureStoreMemory = new Map<string, string>();
    jest.doMock('expo-secure-store', () => ({
      getItemAsync: jest.fn(async (key: string) => mockSecureStoreMemory.get(key) ?? null),
      setItemAsync: jest.fn(async (key: string, value: string) => {
        mockSecureStoreMemory.set(key, value);
      }),
      deleteItemAsync: jest.fn(async (key: string) => {
        mockSecureStoreMemory.delete(key);
      }),
    }));

    // eslint-disable-next-line @typescript-eslint/no-require-imports, global-require
    const { getCategoryBudgets } = require('../../lib/secureStorage');

    // Seed ONLY the legacy flat key — no per-household key, no
    // migration marker, no prior call to migrateLegacyBudgetsToHousehold.
    mockSecureStoreMemory.set('bs.budgets.byCategory', JSON.stringify({ Groceries: 300 }));

    const budgets = await getCategoryBudgets('brand-new-household');

    // Under the original bug (migration only triggered elsewhere), this
    // read would have returned {} — the namespaced key was never
    // written and nothing here would have healed it.
    expect(budgets).toEqual({ Groceries: 300 });
  });

  /**
   * Bug: the migration marker was namespaced per-household
   * (`bs.budgets.legacyMigrated.${householdId}`), so every *new*
   * household looked "unmigrated" on its very first read and blindly
   * inherited this device's old legacy budgets — including a brand-new
   * guest account's freshly created household, which surfaced as
   * "guest sign-in auto-fills random category budgets."
   *
   * Fixed by making the marker device-wide (unsuffixed), so the legacy
   * copy happens at most once ever, for whichever household is read
   * first — any household created afterwards starts empty.
   */
  it('does not re-inject legacy budgets into a second, later household once migration has already run', async () => {
    jest.resetModules();
    const mockSecureStoreMemory = new Map<string, string>();
    jest.doMock('expo-secure-store', () => ({
      getItemAsync: jest.fn(async (key: string) => mockSecureStoreMemory.get(key) ?? null),
      setItemAsync: jest.fn(async (key: string, value: string) => {
        mockSecureStoreMemory.set(key, value);
      }),
      deleteItemAsync: jest.fn(async (key: string) => {
        mockSecureStoreMemory.delete(key);
      }),
    }));

    // eslint-disable-next-line @typescript-eslint/no-require-imports, global-require
    const { getCategoryBudgets } = require('../../lib/secureStorage');

    mockSecureStoreMemory.set('bs.budgets.byCategory', JSON.stringify({ Groceries: 300 }));

    // First household ever read on this device — legitimately inherits
    // the legacy numbers.
    const first = await getCategoryBudgets('household-1');
    expect(first).toEqual({ Groceries: 300 });

    // A second, brand-new household (e.g. a fresh guest account) reads
    // budgets for the first time AFTER migration already ran once —
    // under the original per-household-marker bug this would also
    // inherit { Groceries: 300 }; it should start empty instead.
    const second = await getCategoryBudgets('household-2');
    expect(second).toEqual({});
  });
});
