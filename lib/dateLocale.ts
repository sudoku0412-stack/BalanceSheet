import { format, isToday, isYesterday } from 'date-fns';
import { enUS } from 'date-fns/locale/en-US';
import { fr } from 'date-fns/locale/fr';
import type { Locale } from 'date-fns';
import { translate, type Language } from './i18n';

const LOCALES: Record<Language, Locale> = { en: enUS, fr };

export function dateFnsLocale(language: Language): Locale {
  return LOCALES[language];
}

/** "Sep 4" / "4 sept." */
export function formatMonthDay(date: Date, language: Language): string {
  return format(date, language === 'fr' ? 'd MMM' : 'MMM d', { locale: LOCALES[language] });
}

/** "Sep 4, 2026" / "4 sept. 2026" */
export function formatShortDate(date: Date, language: Language): string {
  return format(date, language === 'fr' ? 'd MMM yyyy' : 'MMM d, yyyy', { locale: LOCALES[language] });
}

/** "September 2026" / "septembre 2026" */
export function formatMonthYear(date: Date, language: Language): string {
  return format(date, 'MMMM yyyy', { locale: LOCALES[language] });
}

/** Locale tag for Intl / toLocale*String. */
export function intlLocale(language: Language): string {
  return language === 'fr' ? 'fr-CA' : 'en-US';
}

/** "Today" / "Yesterday" / "Jul 27" (or "Jul 27, 2026" with `withYear`),
 *  in the given language. */
export function relativeDayLabel(date: Date, language: Language, withYear = false): string {
  if (isToday(date)) return translate(language, 'today');
  if (isYesterday(date)) return translate(language, 'yesterday');
  return withYear ? formatShortDate(date, language) : formatMonthDay(date, language);
}
