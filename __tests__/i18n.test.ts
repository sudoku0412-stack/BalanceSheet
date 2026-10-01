import { en } from '../lib/i18n/en';
import { fr } from '../lib/i18n/fr';
import {
  deviceLanguage,
  getActiveLanguage,
  languageFromLocale,
  pluralCategory,
  resolveLanguage,
  setActiveLanguage,
  tr,
  translate,
} from '../lib/i18n';
import { categoryLabel } from '../lib/categoryLabel';
import { dateFnsLocale, formatMonthDay, formatMonthYear, formatShortDate, intlLocale, relativeDayLabel } from '../lib/dateLocale';
import { frequencyKey } from '../lib/frequencyLabel';

const placeholders = (s: string, ignoreCount = false) =>
  (s.match(/\{\w+\}/g) ?? []).filter((p) => !(ignoreCount && p === '{count}')).sort();

describe('catalogs', () => {
  const enKeys = Object.keys(en);

  it('French defines exactly the English keys', () => {
    expect(Object.keys(fr).sort()).toEqual([...enKeys].sort());
  });

  it('has no empty strings in either language', () => {
    for (const k of enKeys) {
      expect((en as Record<string, string>)[k].length).toBeGreaterThan(0);
      expect((fr as Record<string, string>)[k].trim().length).toBeGreaterThan(0);
    }
  });

  it('French keeps the same {placeholders} as English (singular forms may drop {count})', () => {
    for (const k of enKeys) {
      const ignoreCount = k.endsWith('_one'); // "1 expense" may be written "an expense"
      expect([k, placeholders((fr as Record<string, string>)[k], ignoreCount)]).toEqual([
        k,
        placeholders((en as Record<string, string>)[k], ignoreCount),
      ]);
    }
  });

  it('every plural base has both _one and _other forms', () => {
    const bases = new Set(
      enKeys.filter((k) => /_(one|other)$/.test(k)).map((k) => k.replace(/_(one|other)$/, '')),
    );
    for (const b of bases) {
      expect(enKeys).toContain(`${b}_one`);
      expect(enKeys).toContain(`${b}_other`);
    }
  });
});

describe('translate', () => {
  it('looks up each language', () => {
    expect(translate('en', 'cancel')).toBe('Cancel');
    expect(translate('fr', 'cancel')).toBe('Annuler');
  });

  it('interpolates params and leaves unknown placeholders intact', () => {
    expect(translate('en', 'nameCreated', { name: 'Home' })).toBe('Home created');
    expect(translate('fr', 'nameCreated', { name: 'Maison' })).toBe('Maison créé');
    expect(translate('en', 'nameCreated', {})).toBe('{name} created');
  });

  it('falls back to the key itself for unknown keys', () => {
    expect(translate('fr', 'definitelyNotAKey')).toBe('definitelyNotAKey');
  });

  it('picks plural forms by count (English: only 1 is singular)', () => {
    expect(translate('en', 'expensesThisMonth', { count: 1 })).toBe('1 expense this month');
    expect(translate('en', 'expensesThisMonth', { count: 0 })).toBe('0 expenses this month');
    expect(translate('en', 'expensesThisMonth', { count: 5 })).toBe('5 expenses this month');
  });

  it('picks plural forms by count (French: 0 and 1 are singular)', () => {
    expect(translate('fr', 'expensesThisMonth', { count: 0 })).toBe('0 dépense ce mois-ci');
    expect(translate('fr', 'expensesThisMonth', { count: 1 })).toBe('1 dépense ce mois-ci');
    expect(translate('fr', 'expensesThisMonth', { count: 2 })).toBe('2 dépenses ce mois-ci');
  });

  it('a non-numeric count does not trigger plural lookup', () => {
    expect(translate('en', 'cancel', { count: 'x' })).toBe('Cancel');
  });
});

describe('pluralCategory', () => {
  it('follows CLDR for en and fr', () => {
    expect(pluralCategory('en', 1)).toBe('one');
    expect(pluralCategory('en', 0)).toBe('other');
    expect(pluralCategory('en', 1.5)).toBe('other');
    expect(pluralCategory('fr', 0)).toBe('one');
    expect(pluralCategory('fr', 1.5)).toBe('one');
    expect(pluralCategory('fr', 2)).toBe('other');
  });
});

describe('language resolution', () => {
  it('maps device locales to supported languages', () => {
    expect(languageFromLocale('fr-CA')).toBe('fr');
    expect(languageFromLocale('fr_FR')).toBe('fr');
    expect(languageFromLocale('en-US')).toBe('en');
    expect(languageFromLocale('de-DE')).toBe('en');
    expect(languageFromLocale(undefined)).toBe('en');
    expect(languageFromLocale('')).toBe('en');
  });

  it('system follows the device; an explicit choice wins', () => {
    expect(resolveLanguage('system', 'fr')).toBe('fr');
    expect(resolveLanguage('system', 'en')).toBe('en');
    expect(resolveLanguage('en', 'fr')).toBe('en');
    expect(resolveLanguage('fr', 'en')).toBe('fr');
  });

  it('deviceLanguage returns a supported language', () => {
    expect(['en', 'fr']).toContain(deviceLanguage());
  });
});

describe('active language (non-React translate)', () => {
  afterEach(() => setActiveLanguage('en'));

  it('tr follows setActiveLanguage', () => {
    expect(tr('cancel')).toBe('Cancel');
    setActiveLanguage('fr');
    expect(getActiveLanguage()).toBe('fr');
    expect(tr('cancel')).toBe('Annuler');
  });
});

describe('categoryLabel', () => {
  afterEach(() => setActiveLanguage('en'));

  it('translates built-in expense and income categories, passes custom names through', () => {
    setActiveLanguage('fr');
    expect(categoryLabel('Groceries')).toBe('Épicerie');
    expect(categoryLabel('Salary')).toBe('Salaire');
    expect(categoryLabel('InvestmentReturn')).toBe("Rendement d'investissement");
    expect(categoryLabel('Other')).toBe('Autre');
    expect(categoryLabel('Pets')).toBe('Pets');
    setActiveLanguage('en');
    expect(categoryLabel('Groceries')).toBe('Groceries');
    expect(categoryLabel('InvestmentReturn')).toBe('Investment return');
  });
});

describe('frequencyKey', () => {
  it('maps known frequencies and rejects unknown ones', () => {
    expect(frequencyKey('weekly')).toBe('weekly');
    expect(frequencyKey('biweekly')).toBe('biweekly');
    expect(frequencyKey('nope')).toBeNull();
  });
});

describe('dateLocale', () => {
  const d = new Date(2026, 8, 4); // 4 Sep 2026, local time

  it('formats month/day, short date, month/year per language', () => {
    expect(formatMonthDay(d, 'en')).toBe('Sep 4');
    expect(formatMonthDay(d, 'fr')).toBe('4 sept.');
    expect(formatShortDate(d, 'en')).toBe('Sep 4, 2026');
    expect(formatShortDate(d, 'fr')).toBe('4 sept. 2026');
    expect(formatMonthYear(d, 'en')).toBe('September 2026');
    expect(formatMonthYear(d, 'fr')).toBe('septembre 2026');
  });

  it('relativeDayLabel says Today/Yesterday in the language, else the date', () => {
    const today = new Date();
    const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
    expect(relativeDayLabel(today, 'en')).toBe('Today');
    expect(relativeDayLabel(today, 'fr')).toBe("Aujourd'hui");
    expect(relativeDayLabel(yesterday, 'fr')).toBe('Hier');
    expect(relativeDayLabel(d, 'fr')).toBe('4 sept.');
    expect(relativeDayLabel(d, 'fr', true)).toBe('4 sept. 2026');
  });

  it('exposes date-fns locales and Intl tags', () => {
    expect(dateFnsLocale('fr').code).toBe('fr');
    expect(dateFnsLocale('en').code).toBe('en-US');
    expect(intlLocale('fr')).toBe('fr-CA');
    expect(intlLocale('en')).toBe('en-US');
  });
});
