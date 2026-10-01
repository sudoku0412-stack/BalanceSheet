import { en } from './en';
import { fr } from './fr';

export type Language = 'en' | 'fr';
/** What the user picked in Settings; 'system' follows the device. */
export type LanguagePreference = Language | 'system';

export const SUPPORTED_LANGUAGES: Language[] = ['en', 'fr'];

/** Native names, shown in the language picker regardless of the active
 *  language so a user who can't read the current one can still find theirs. */
export const LANGUAGE_NAMES: Record<Language, string> = {
  en: 'English',
  fr: 'Français',
};

type CatalogKey = keyof typeof en;
/** `foo_one` / `foo_other` plural variants are addressed as plain `foo`. */
type PluralBase<K> = K extends `${infer B}_one` | `${infer B}_other` ? B : never;
export type TranslationKey = CatalogKey | PluralBase<CatalogKey>;
export type Params = Record<string, string | number>;

const CATALOGS: Record<Language, Record<string, string>> = { en, fr };

/** Maps a BCP-47 locale ("fr-CA", "en_US") to a supported language. */
export function languageFromLocale(locale: string | undefined | null): Language {
  const base = (locale ?? '').toLowerCase().split(/[-_]/)[0];
  return (SUPPORTED_LANGUAGES as string[]).includes(base) ? (base as Language) : 'en';
}

export function deviceLanguage(): Language {
  try {
    return languageFromLocale(Intl.DateTimeFormat().resolvedOptions().locale);
  } catch {
    return 'en';
  }
}

export function resolveLanguage(pref: LanguagePreference, device: Language): Language {
  return pref === 'system' ? device : pref;
}

/** CLDR plural category for the two supported languages: English "one"
 *  is exactly 1; French "one" is 0 through (but not including) 2. */
export function pluralCategory(lang: Language, count: number): 'one' | 'other' {
  if (lang === 'fr') return count >= 0 && count < 2 ? 'one' : 'other';
  return count === 1 ? 'one' : 'other';
}

function interpolate(template: string, params?: Params): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in params ? String(params[name]) : match,
  );
}

/**
 * Looks up `key` in the language's catalog. When `params.count` is a
 * number and `<key>_one` / `<key>_other` exist, the matching plural form
 * is used. Falls back to English, then to the key itself, so a missing
 * translation never renders blank.
 */
export function translate(lang: Language, key: string, params?: Params): string {
  const catalog = CATALOGS[lang];
  let resolvedKey = key;
  if (params && typeof params.count === 'number') {
    const pluralKey = `${key}_${pluralCategory(lang, params.count)}`;
    if (pluralKey in catalog || pluralKey in en) resolvedKey = pluralKey;
  }
  const template = catalog[resolvedKey] ?? (en as Record<string, string>)[resolvedKey] ?? key;
  return interpolate(template, params);
}

let activeLanguage: Language = 'en';

/** Kept in sync by I18nProvider so non-React code (error mappers,
 *  notification text) can translate without a hook. */
export function setActiveLanguage(lang: Language): void {
  activeLanguage = lang;
}

export function getActiveLanguage(): Language {
  return activeLanguage;
}

/** Translate with the active app language, outside React. */
export function tr(key: TranslationKey, params?: Params): string {
  return translate(activeLanguage, key, params);
}
