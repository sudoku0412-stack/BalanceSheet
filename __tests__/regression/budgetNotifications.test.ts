/**
 * Regression tests for lib/notifications.ts budget-alert bugs.
 */
import { Receipt } from '../../types';

// Stateful in-memory SecureStore mock so throttle-date persistence across
// get/set calls actually behaves like the real module (needed for the
// per-household-throttle regression test below).
const mockSecureStoreMemory = new Map<string, string>();
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async (key: string) => mockSecureStoreMemory.get(key) ?? null),
  setItemAsync: jest.fn(async (key: string, value: string) => {
    mockSecureStoreMemory.set(key, value);
  }),
  deleteItemAsync: jest.fn(async (key: string) => {
    mockSecureStoreMemory.delete(key);
  }),
}));

jest.mock('../../lib/cloudSync', () => ({
  getHouseholdMemberPushTokens: jest.fn(async () => ['token-a']),
  getHouseholdMembers: jest.fn(async () => []),
  getPushTokensForUids: jest.fn(async () => []),
}));

jest.mock('../../lib/database', () => ({
  getCurrentHouseholdId: jest.fn(() => 'household-1'),
  getReceiptsByMonth: jest.fn(async () => []),
}));

// lib/recurring.ts pulls in `uuid` (ESM-only build under this jest config)
// via getAllReceipts/saveReceipt/updateReceipt, none of which this test
// needs — only the pure RECURRING_BUDGET_KEY/isRecurringExpense helpers
// that lib/notifications.ts actually uses. Re-implemented here to match
// the real module's semantics exactly.
jest.mock('../../lib/recurring', () => ({
  RECURRING_BUDGET_KEY: 'Recurring',
  isRecurringExpense: (r: any) => Boolean(r.recurring) || Boolean(r.isRecurringOccurrence),
}));

const originalFetch = global.fetch;

beforeEach(() => {
  mockSecureStoreMemory.clear();
  jest.clearAllMocks();
  global.fetch = jest.fn(async () => ({ ok: true } as Response));
});

afterAll(() => {
  global.fetch = originalFetch;
});

function makeReceipt(overrides: Partial<Receipt>): Receipt {
  return {
    id: overrides.id ?? 'r1',
    userId: 'u1',
    storeName: 'Store',
    date: '2026-08-01',
    category: 'Groceries',
    totalAmount: 0,
    currency: 'USD',
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    ...overrides,
  } as Receipt;
}

describe('Regression: Recurring-category double-counting (lib/notifications.ts)', () => {
  /**
   * Bug: computeBudgetStatusSummary grouped spend by r.category, then
   * ALSO added every recurring receipt's amount to the separate
   * RECURRING_BUDGET_KEY axis — including receipts whose real category
   * was literally "Recurring", double-counting them against both the
   * "Recurring" category budget AND the Recurring pseudo-budget (which
   * share the same key). Fixed with a guard: only add to the pseudo-axis
   * when `r.category !== RECURRING_BUDGET_KEY`.
   *
   * Test: a single $80 receipt, category "Recurring" (so it collides
   * with RECURRING_BUDGET_KEY), flagged as a recurring occurrence, with
   * a $100 budget on "Recurring". Single-counted, 80/100 = 80% -> "watch"
   * (nearing). Double-counted, it would be 160/100 = 160% -> "over".
   * Against the original buggy guard, this fires an "Over budget" push;
   * the fix fires "Nearing budget".
   */
  it('does not double count a receipt whose category is literally the Recurring key', async () => {
    const { notifyHouseholdOfBudgetStatus } = require('../../lib/notifications');
    const { getCategoryBudgets, setCategoryBudget, setBudgetAlertsEnabled } = require('../../lib/secureStorage');

    // Budget alerts default OFF now (turning them on is what triggers the
    // permission prompt) — this test is about the double-counting bug,
    // not the default, so opt in explicitly.
    await setBudgetAlertsEnabled('household-1', true);
    await setCategoryBudget('household-1', 'Recurring', 100);
    // sanity: budget actually persisted through the stateful mock
    expect(await getCategoryBudgets('household-1')).toMatchObject({ Recurring: 100 });

    const receipt = makeReceipt({
      id: 'r-recurring',
      category: 'Recurring',
      totalAmount: 80,
      isRecurringOccurrence: true,
    });

    await notifyHouseholdOfBudgetStatus({
      householdId: 'household-1',
      selfUid: 'self-uid',
      monthReceipts: [receipt],
    });

    expect(global.fetch).toHaveBeenCalledTimes(1);
    const body = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body);
    expect(body[0].title).toBe('Nearing budget');
    expect(body[0].title).not.toBe('Over budget');
  });
});

describe('Regression: per-household budget-alert throttle (lib/notifications.ts)', () => {
  /**
   * Bug: lastBudgetAlertDate was a single flat SecureStore key. A user
   * belonging to 2+ households could have today's alert slot consumed by
   * whichever household got checked first, silently starving every other
   * household's own over-budget alert for the rest of the day.
   *
   * Fixed: the throttle date is namespaced per household id
   * (lib/secureStorage.ts's getLastBudgetAlertDate/setLastBudgetAlertDate).
   *
   * Test: mark household A's throttle as already used today, then assert
   * household B's throttle state is untouched (independent) — checked
   * directly through the exported per-household accessors, which is what
   * checkBudgetsAndNotify relies on to decide whether to fire.
   */
  it('gives each household independent throttle state', async () => {
    const {
      getLastBudgetAlertDate,
      setLastBudgetAlertDate,
    } = require('../../lib/secureStorage');

    const today = new Date().toISOString().slice(0, 10);
    await setLastBudgetAlertDate('household-A', today);

    expect(await getLastBudgetAlertDate('household-A')).toBe(today);
    // Household B must NOT see household A's throttle date — under the
    // original flat-key bug this would incorrectly also return `today`.
    expect(await getLastBudgetAlertDate('household-B')).toBeNull();
  });
});
