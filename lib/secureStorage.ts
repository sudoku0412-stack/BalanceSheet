import * as SecureStore from 'expo-secure-store';

const Keys = {
  onboardingSeen: 'bs.onboarding.seen',
  anthropicApiKey: 'bs.anthropic.apiKey',
  geminiApiKey: 'bs.gemini.apiKey',
  aiClassifyEnabled: 'bs.aiClassify.enabled',
  // One-shot Phase-2 marker — once we've successfully uploaded all
  // existing local receipts to Firestore for this user we set this so
  // the migration doesn't re-run on every launch. Stored per-user via
  // the suffix `:${uid}` so different users on the same device each
  // do their own one-time backfill.
  cloudMigrationDone: 'bs.cloud.migrationDone',
  categoryBudgets: 'bs.budgets.byCategory',
  budgetAlertsEnabled: 'bs.budgets.alertsEnabled',
  currency: 'bs.currency',
} as const;

export async function getOnboardingSeen(): Promise<boolean> {
  const v = await SecureStore.getItemAsync(Keys.onboardingSeen);
  return v === '1';
}

export async function setOnboardingSeen(): Promise<void> {
  await SecureStore.setItemAsync(Keys.onboardingSeen, '1');
}

export async function getCloudMigrationDone(uid: string): Promise<boolean> {
  const v = await SecureStore.getItemAsync(`${Keys.cloudMigrationDone}:${uid}`);
  return v === '1';
}

export async function setCloudMigrationDone(uid: string): Promise<void> {
  await SecureStore.setItemAsync(`${Keys.cloudMigrationDone}:${uid}`, '1');
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

export async function getCategoryBudgets(): Promise<Record<string, number>> {
  const v = await SecureStore.getItemAsync(Keys.categoryBudgets);
  if (!v) return {};
  try {
    return JSON.parse(v) as Record<string, number>;
  } catch {
    return {};
  }
}

export async function setCategoryBudget(category: string, amount: number): Promise<void> {
  const current = await getCategoryBudgets();
  const next = { ...current, [category]: amount };
  await SecureStore.setItemAsync(Keys.categoryBudgets, JSON.stringify(next));
}

export async function getBudgetAlertsEnabled(): Promise<boolean> {
  const v = await SecureStore.getItemAsync(Keys.budgetAlertsEnabled);
  return v !== '0'; // default on
}

export async function setBudgetAlertsEnabled(enabled: boolean): Promise<void> {
  await SecureStore.setItemAsync(Keys.budgetAlertsEnabled, enabled ? '1' : '0');
}

export async function getCurrency(): Promise<string | null> {
  return await SecureStore.getItemAsync(Keys.currency);
}

export async function setCurrency(code: string): Promise<void> {
  await SecureStore.setItemAsync(Keys.currency, code);
}

export async function resetAllSecureStorage(): Promise<void> {
  await Promise.all(
    Object.values(Keys).map((k) => SecureStore.deleteItemAsync(k)),
  );
}
