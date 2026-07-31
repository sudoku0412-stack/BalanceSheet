import * as Notifications from 'expo-notifications';
import {
  getBudgetAlertsEnabled,
  getCategoryBudgets,
  getLastBudgetAlertDate,
  setLastBudgetAlertDate,
} from './secureStorage';
import { getReceiptsByMonth } from './database';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

export async function getNotificationPermissionGranted(): Promise<boolean> {
  const { status } = await Notifications.getPermissionsAsync();
  return status === 'granted';
}

/** Ask the OS for notification permission. Returns whether it's granted
 *  after the prompt (or already was). Only call this from an explicit
 *  user action (e.g. turning the Settings toggle on) — never silently
 *  on app launch. */
export async function requestNotificationPermission(): Promise<boolean> {
  const existing = await Notifications.getPermissionsAsync();
  if (existing.status === 'granted') return true;
  const { status } = await Notifications.requestPermissionsAsync();
  return status === 'granted';
}

const BUDGET_STATUS_THRESHOLDS = { watch: 0.7, over: 0.9 };

function statusFor(spent: number, limit: number): 'onTrack' | 'watch' | 'over' {
  if (limit <= 0) return 'onTrack';
  const pct = spent / limit;
  if (pct > BUDGET_STATUS_THRESHOLDS.over) return 'over';
  if (pct > BUDGET_STATUS_THRESHOLDS.watch) return 'watch';
  return 'onTrack';
}

function todayYmd(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Check this month's spend against each category's budget limit and
 * fire ONE local notification summarizing whichever categories are
 * "over" or "watch" — never one notification per category. Does
 * nothing (silently) unless BOTH the in-app "Budget alerts" toggle is
 * on AND the OS notification permission is actually granted; the
 * toggle alone was previously a no-op with nothing wired to it.
 *
 * Safe to call on every app foreground — throttled to at most once
 * per calendar day via lib/secureStorage's lastBudgetAlertDate, so
 * calling it repeatedly (e.g. every time Home gains focus) doesn't
 * spam the user.
 */
export async function checkBudgetsAndNotify(): Promise<void> {
  const [alertsEnabled, permissionGranted, lastAlertDate] = await Promise.all([
    getBudgetAlertsEnabled(),
    getNotificationPermissionGranted(),
    getLastBudgetAlertDate(),
  ]);
  if (!alertsEnabled || !permissionGranted) return;
  if (lastAlertDate === todayYmd()) return;

  const budgets = await getCategoryBudgets();
  const categoriesWithBudgets = Object.entries(budgets).filter(([, limit]) => limit > 0);
  if (categoriesWithBudgets.length === 0) return;

  const now = new Date();
  const receipts = await getReceiptsByMonth(now.getFullYear(), now.getMonth() + 1);
  const spentByCategory: Record<string, number> = {};
  for (const r of receipts) {
    spentByCategory[r.category] = (spentByCategory[r.category] ?? 0) + r.totalAmount;
  }

  const over: string[] = [];
  const watch: string[] = [];
  for (const [category, limit] of categoriesWithBudgets) {
    const spent = spentByCategory[category] ?? 0;
    const status = statusFor(spent, limit);
    if (status === 'over') over.push(category);
    else if (status === 'watch') watch.push(category);
  }
  if (over.length === 0 && watch.length === 0) return;

  const title = over.length > 0 ? 'Over budget' : 'Nearing budget';
  const parts: string[] = [];
  if (over.length > 0) parts.push(`Over: ${over.join(', ')}`);
  if (watch.length > 0) parts.push(`Nearing limit: ${watch.join(', ')}`);

  await Notifications.scheduleNotificationAsync({
    content: { title, body: parts.join(' · ') },
    trigger: null, // fire immediately
  });
  await setLastBudgetAlertDate(todayYmd());
}
