import type { TranslationKey } from './i18n';

export type FrequencyId = 'weekly' | 'biweekly' | 'monthly' | 'yearly';

const KEYS: Record<FrequencyId, TranslationKey> = {
  weekly: 'weekly',
  biweekly: 'biweekly',
  monthly: 'monthly',
  yearly: 'yearly',
};

/** Translation key for a recurring-schedule frequency. */
export function frequencyKey(frequency: string): TranslationKey | null {
  return KEYS[frequency as FrequencyId] ?? null;
}
