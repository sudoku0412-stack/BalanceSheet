import * as SecureStore from 'expo-secure-store';

const Keys = {
  onboardingSeen: 'bs.onboarding.seen',
  anthropicApiKey: 'bs.anthropic.apiKey',
  geminiApiKey: 'bs.gemini.apiKey',
  aiClassifyEnabled: 'bs.aiClassify.enabled',
  // One-shot Phase-2 marker — once we've successfully uploaded all
  // existing local receipts to Firestore for this user we set this so
  // the migration doesn't re-run on every launch. Stored per-user via
  // the suffix `.${uid}` so different users on the same device each
  // do their own one-time backfill.
  cloudMigrationDone: 'bs.cloud.migrationDone',
  categoryBudgets: 'bs.budgets.byCategory',
  budgetAlertsEnabled: 'bs.budgets.alertsEnabled',
  currency: 'bs.currency',
  lastBudgetAlertDate: 'bs.budgets.lastAlertDate',
  // Multi-household support: one-time per-household marker so the
  // legacy flat budgets key (below) gets copied into its
  // household-namespaced key exactly once. Mirrors cloudMigrationDone's
  // `.${uid}` suffix pattern.
  legacyBudgetsMigrated: 'bs.budgets.legacyMigrated',
} as const;

export async function getOnboardingSeen(): Promise<boolean> {
  const v = await SecureStore.getItemAsync(Keys.onboardingSeen);
  return v === '1';
}

export async function setOnboardingSeen(): Promise<void> {
  await SecureStore.setItemAsync(Keys.onboardingSeen, '1');
}

export async function getCloudMigrationDone(uid: string): Promise<boolean> {
  const v = await SecureStore.getItemAsync(`${Keys.cloudMigrationDone}.${uid}`);
  return v === '1';
}

export async function setCloudMigrationDone(uid: string): Promise<void> {
  await SecureStore.setItemAsync(`${Keys.cloudMigrationDone}.${uid}`, '1');
}

export async function getAnthropicApiKey(): Promise<string | null> {
  return await SecureStore.getItemAsync(Keys.anthropicApiKey);
}

export async function setAnthropicApiKey(key: string | null): Promise<void> {
  if (key && key.trim()) {
    await SecureStore.setItemAsync(Keys.anthropicApiKey, key.trim());
  } else {
    await SecureStore.deleteItemAsync(Keys.anthropicApiKey);
  }
}

export async function getGeminiApiKey(): Promise<string | null> {
  return await SecureStore.getItemAsync(Keys.geminiApiKey);
}

export async function setGeminiApiKey(key: string | null): Promise<void> {
  if (key && key.trim()) {
    await SecureStore.setItemAsync(Keys.geminiApiKey, key.trim());
  } else {
    await SecureStore.deleteItemAsync(Keys.geminiApiKey);
  }
}

export async function getAiClassifyEnabled(): Promise<boolean> {
  const v = await SecureStore.getItemAsync(Keys.aiClassifyEnabled);
  return v === '1';
}

export async function setAiClassifyEnabled(enabled: boolean): Promise<void> {
  if (enabled) {
    await SecureStore.setItemAsync(Keys.aiClassifyEnabled, '1');
  } else {
    await SecureStore.deleteItemAsync(Keys.aiClassifyEnabled);
  }
}

/**
 * Budgets are namespaced per household (multi-household support) —
 * each household has its own category limits/alerts toggle, mirroring
 * the `.${uid}` suffix pattern already used for `cloudMigrationDone`.
 *
 * Self-healing: if the namespaced key has never been written, this
 * reads are read straight through `migrateLegacyBudgetsToHousehold`
 * first — this makes the migration a normal side effect of the very
 * first read instead of something a caller has to remember to await
 * before reading. Depending solely on AuthContext's fire-and-forget
 * sign-in call was a race: reading budgets before that call resolved
 * (or if it silently failed) surfaced the namespaced key as
 * permanently empty, which read as "my budgets got wiped."
 */
export async function getCategoryBudgets(householdId: string): Promise<Record<string, number>> {
  await migrateLegacyBudgetsToHousehold(householdId);
  const v = await SecureStore.getItemAsync(`${Keys.categoryBudgets}.${householdId}`);
  if (!v) return {};
  try {
    return JSON.parse(v) as Record<string, number>;
  } catch {
    return {};
  }
}

export async function setCategoryBudget(
  householdId: string,
  category: string,
  amount: number,
): Promise<void> {
  const current = await getCategoryBudgets(householdId);
  const next = { ...current, [category]: amount };
  await SecureStore.setItemAsync(`${Keys.categoryBudgets}.${householdId}`, JSON.stringify(next));
}

export async function getBudgetAlertsEnabled(householdId: string): Promise<boolean> {
  await migrateLegacyBudgetsToHousehold(householdId);
  const v = await SecureStore.getItemAsync(`${Keys.budgetAlertsEnabled}.${householdId}`);
  return v !== '0'; // default on
}

export async function setBudgetAlertsEnabled(householdId: string, enabled: boolean): Promise<void> {
  await SecureStore.setItemAsync(`${Keys.budgetAlertsEnabled}.${householdId}`, enabled ? '1' : '0');
}

export type BudgetsSnapshot = {
  byCategory: Record<string, number>;
  alertsEnabled: boolean;
};

/** This device's current budget settings for the given household,
 *  stamped onto an invite doc so a newly-added household member starts
 *  with the SAME budget alert amounts as whoever added them (see
 *  lib/cloudSync.ts). */
export async function getBudgetsSnapshot(householdId: string): Promise<BudgetsSnapshot> {
  const [byCategory, alertsEnabled] = await Promise.all([
    getCategoryBudgets(householdId),
    getBudgetAlertsEnabled(householdId),
  ]);
  return { byCategory, alertsEnabled };
}

/** Overwrites this device's budgets for the given household with a
 *  snapshot pulled from an invite or a cloud sync — called right after
 *  accepting an invite (so both members start in sync) and by
 *  subscribeToHouseholdBudgets on every remote change. */
export async function applyBudgetsSnapshot(
  householdId: string,
  snapshot: BudgetsSnapshot,
): Promise<void> {
  for (const [category, amount] of Object.entries(snapshot.byCategory)) {
    await setCategoryBudget(householdId, category, amount);
  }
  await setBudgetAlertsEnabled(householdId, snapshot.alertsEnabled);
}

/**
 * One-time copy of the legacy flat (pre-multi-household) budgets key
 * into `householdId`'s namespaced key. Every pre-existing user has
 * exactly one household, so this 1:1 copy is always unambiguous. Guarded
 * by a per-household marker so it never re-runs (and never clobbers
 * budgets someone has since changed in the new namespaced key). Safe to
 * call on every sign-in.
 */
export async function migrateLegacyBudgetsToHousehold(householdId: string): Promise<void> {
  const marker = `${Keys.legacyBudgetsMigrated}.${householdId}`;
  const already = await SecureStore.getItemAsync(marker);
  if (already === '1') return;
  const legacyBudgets = await SecureStore.getItemAsync(Keys.categoryBudgets);
  const legacyAlerts = await SecureStore.getItemAsync(Keys.budgetAlertsEnabled);
  if (legacyBudgets) {
    await SecureStore.setItemAsync(`${Keys.categoryBudgets}.${householdId}`, legacyBudgets);
  }
  if (legacyAlerts) {
    await SecureStore.setItemAsync(`${Keys.budgetAlertsEnabled}.${householdId}`, legacyAlerts);
  }
  await SecureStore.setItemAsync(marker, '1');
}

/** Removes a deleted household's namespaced budget keys (amounts,
 *  alerts toggle, migration marker) from this device. Called by the
 *  owner's device right after cloudSync.deleteHousehold succeeds. */
export async function clearBudgetsForHousehold(householdId: string): Promise<void> {
  await Promise.all([
    SecureStore.deleteItemAsync(`${Keys.categoryBudgets}.${householdId}`),
    SecureStore.deleteItemAsync(`${Keys.budgetAlertsEnabled}.${householdId}`),
    SecureStore.deleteItemAsync(`${Keys.legacyBudgetsMigrated}.${householdId}`),
  ]);
}

export async function getCurrency(): Promise<string | null> {
  return await SecureStore.getItemAsync(Keys.currency);
}

/** Namespaced per household (multi-household support) — otherwise a
 *  user with 2+ households could have today's local budget-alert slot
 *  used up by whichever household happens to get checked first, and
 *  a second household's own over-budget state would be silently
 *  skipped for the rest of the day. */
export async function getLastBudgetAlertDate(householdId: string): Promise<string | null> {
  return await SecureStore.getItemAsync(`${Keys.lastBudgetAlertDate}.${householdId}`);
}

export async function setLastBudgetAlertDate(householdId: string, ymd: string): Promise<void> {
  await SecureStore.setItemAsync(`${Keys.lastBudgetAlertDate}.${householdId}`, ymd);
}

export async function setCurrency(code: string): Promise<void> {
  await SecureStore.setItemAsync(Keys.currency, code);
}

export async function resetAllSecureStorage(): Promise<void> {
  await Promise.all(
    Object.values(Keys).map((k) => SecureStore.deleteItemAsync(k)),
  );
}
