import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import {
  deviceLanguage,
  resolveLanguage,
  setActiveLanguage,
  translate,
  type Language,
  type LanguagePreference,
  type Params,
  type TranslationKey,
} from './i18n';
import { getLanguagePreference, setLanguagePreference } from './secureStorage';

export type TFn = (key: TranslationKey, params?: Params) => string;
type TFunction = TFn;

type I18nValue = {
  /** The language actually in use (preference resolved against the device). */
  language: Language;
  /** The raw choice from Settings. */
  preference: LanguagePreference;
  setPreference: (pref: LanguagePreference) => void;
  t: TFunction;
};

const englishT: TFunction = (key, params) => translate('en', key, params);

// Default value = English, so screens rendered without a provider (unit
// tests, error boundaries) still show readable text.
const I18nContext = createContext<I18nValue>({
  language: 'en',
  preference: 'system',
  setPreference: () => {},
  t: englishT,
});

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [preference, setPreferenceState] = useState<LanguagePreference>('system');

  useEffect(() => {
    getLanguagePreference()
      .then(setPreferenceState)
      .catch(() => {});
  }, []);

  const setPreference = useCallback((pref: LanguagePreference) => {
    setPreferenceState(pref);
    void setLanguagePreference(pref);
  }, []);

  const language = resolveLanguage(preference, deviceLanguage());
  // Synchronous (not an effect) so non-React helpers see the new language
  // in the same render pass that switches the UI.
  setActiveLanguage(language);
  const value = useMemo<I18nValue>(
    () => ({
      language,
      preference,
      setPreference,
      t: (key, params) => translate(language, key, params),
    }),
    [language, preference, setPreference],
  );

  return React.createElement(I18nContext.Provider, { value }, children);
}

/** Translate function bound to the active language; re-renders on change. */
export function useT(): TFunction {
  return useContext(I18nContext).t;
}

/** Language state for Settings' picker and locale-aware formatting. */
export function useLanguage(): Pick<I18nValue, 'language' | 'preference' | 'setPreference'> {
  const { language, preference, setPreference } = useContext(I18nContext);
  return { language, preference, setPreference };
}
