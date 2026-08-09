import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { StyleSheet, useColorScheme } from 'react-native';
import { Category } from '../types';
import { getThemePreference, setThemePreference, ThemePreference } from '../lib/secureStorage';

/**
 * Theme system. Light + dark palettes that mirror each other by shape,
 * keyed off the system color scheme via `useColorScheme()`. Components
 * that should react to theme changes use the `useTheme()` hook + a
 * useMemo'd `StyleSheet.create` block:
 *
 *   const theme = useTheme();
 *   const styles = useMemo(() => makeStyles(theme), [theme]);
 *
 * Tokens below are taken verbatim from the "eXp Data Privacy Design
 * System" handoff (colors_and_type.css + design README): a cool
 * navy/slate/charcoal palette, near-square 2px radii, and a strict
 * Manrope-for-headlines / Roboto-for-body / Roboto-Mono-for-numbers
 * type system. Font family names below (e.g. "Manrope_800ExtraBold")
 * match the @expo-google-fonts packages loaded in app/_layout.tsx —
 * use t.fonts.* instead of fontWeight, since fontWeight is ignored
 * once a custom fontFamily is set.
 */

const BRAND = {
  primary: '#0C0F24', // dark-navy — primary buttons, hero card, nav active
  primaryHover: '#1A1F3A',
  accent: '#506CAA', // slate-blue — links, "Watch" status, Food & Dining
  accentHover: '#41598F',
  accentTint: '#DCE3EF',
  success: '#2F6F66', // status-approved — "On track", Groceries
  error: '#8A2A2E', // status-critical — "Over", Entertainment, destructive
  warning: '#506CAA', // brand kit has no warm warning color; reuse accent
};

const CATEGORY_COLORS_LIGHT = {
  Groceries: '#2F6F66',
  Electronics: '#0C0F24',
  Dining: '#506CAA',
  Pharmacy: '#31303F',
  Gas: '#91A3C9',
  Clothing: '#0C0F24',
  Entertainment: '#8A2A2E',
  Travel: '#91A3C9',
  Healthcare: '#31303F',
  Electricity: '#A67C00',
  Recurring: '#6B5CA5',
  Other: '#686672',
} as Record<Category, string>;

// "Shopping"-family categories (Electronics, Clothing) swap to a lighter
// blue in dark mode so they stay visible against dark surfaces — the one
// documented category-color exception in the design spec.
const CATEGORY_COLORS_DARK = {
  ...CATEGORY_COLORS_LIGHT,
  Electronics: '#8B93C9',
  Clothing: '#8B93C9',
} as Record<Category, string>;

const SHAPE = {
  spacing: { xs: 4, sm: 8, md: 16, lg: 24, xl: 32, xxl: 48 },
  // Mostly-square design system: 2px default, 4px for hero/icon tiles,
  // 8px used sparingly, 999px only for avatars/pills/toggles/the FAB.
  radius: { sm: 2, md: 2, lg: 4, xl: 8, full: 999 },
  font: { xs: 12, sm: 13, md: 16, lg: 18, xl: 20, xxl: 24, xxxl: 32 },
};

// Manrope: headlines, buttons, labels, eyebrows. Roboto: all body copy.
// Roboto Mono: currency amounts and budget numbers. Never mix families
// across those roles — that's a strict rule in the source design system.
const FONTS = {
  display: {
    light: 'Manrope_300Light',
    medium: 'Manrope_500Medium',
    bold: 'Manrope_700Bold',
    extraBold: 'Manrope_800ExtraBold',
  },
  body: {
    thin: 'Roboto_100Thin',
    light: 'Roboto_300Light',
    regular: 'Roboto_400Regular',
    medium: 'Roboto_500Medium',
  },
  mono: {
    regular: 'RobotoMono_400Regular',
    medium: 'RobotoMono_500Medium',
  },
};

export const darkTheme = {
  isDark: true,
  colors: {
    background: '#10121F', // paper-2
    surface: '#181B29', // paper-1
    surfaceHigh: '#232743', // paper-3
    border: '#2A2E4A', // rule-1
    borderLight: '#363B5C',

    ...BRAND,
    primaryFaint: 'rgba(80, 108, 170, 0.18)',
    successFaint: 'rgba(79, 163, 148, 0.18)',
    errorFaint: 'rgba(217, 104, 109, 0.18)',
    success: '#4FA394', // dark-mode status-approved override
    error: '#D9686D', // dark-mode status-critical override

    textPrimary: '#F4F5FA', // ink-1
    textSecondary: '#C7CADC', // lightened ink-2 for dark surfaces
    textMuted: '#8B90AE', // ink-4

    tabActive: '#8BA3E8',
    tabInactive: '#5D6284',

    category: CATEGORY_COLORS_DARK,
  },
  fonts: FONTS,
  ...SHAPE,
};

export const lightTheme = {
  isDark: false,
  colors: {
    background: '#F7F7F8', // paper-2
    surface: '#FFFFFF', // paper-1
    surfaceHigh: '#EEEEEE', // paper-3
    border: '#E4E4E7', // rule-1
    borderLight: '#D2D2D6', // rule-2

    ...BRAND,
    primaryFaint: 'rgba(12, 15, 36, 0.08)',
    successFaint: '#E0EBE8',
    errorFaint: '#F0DEDE',

    textPrimary: '#000000', // ink-1
    textSecondary: '#31303F', // ink-2 charcoal-blue
    textMuted: '#686672', // ink-4 moss-grey

    tabActive: '#0C0F24',
    tabInactive: '#9C9AA4',

    category: CATEGORY_COLORS_LIGHT,
  },
  fonts: FONTS,
  ...SHAPE,
};

export type Theme = typeof darkTheme;

const ThemeContext = createContext<Theme>(darkTheme);

type ThemePreferenceContextValue = {
  preference: ThemePreference;
  setPreference: (pref: ThemePreference) => void;
};

const ThemePreferenceContext = createContext<ThemePreferenceContextValue>({
  preference: 'system',
  setPreference: () => {},
});

/**
 * Wrap the app's root in this provider. Resolves the active theme from
 * the user's manual Settings override (see useThemePreference below) —
 * defaulting to 'system', which follows useColorScheme() and re-renders
 * consumers when the user toggles light/dark mode in their OS settings.
 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const scheme = useColorScheme();
  const [preference, setPreferenceState] = useState<ThemePreference>('system');

  useEffect(() => {
    getThemePreference().then(setPreferenceState);
  }, []);

  const setPreference = (pref: ThemePreference) => {
    setPreferenceState(pref);
    void setThemePreference(pref);
  };

  const resolvedScheme = preference === 'system' ? scheme : preference;
  const value = useMemo(
    () => (resolvedScheme === 'light' ? lightTheme : darkTheme),
    [resolvedScheme],
  );
  const preferenceValue = useMemo(
    () => ({ preference, setPreference }),
    [preference],
  );

  return React.createElement(
    ThemePreferenceContext.Provider,
    { value: preferenceValue },
    React.createElement(ThemeContext.Provider, { value }, children),
  );
}

/** Returns the active theme (reactive — re-renders on system or manual change). */
export function useTheme(): Theme {
  return useContext(ThemeContext);
}

/** Settings' "Appearance" control reads/writes this — the user's raw
 *  light/dark/system choice, as opposed to useTheme()'s already-resolved
 *  palette. */
export function useThemePreference(): ThemePreferenceContextValue {
  return useContext(ThemePreferenceContext);
}

/**
 * Build a theme-aware StyleSheet inside a component. Re-computes only
 * when the theme changes, so it's safe to call on every render.
 *
 *   const styles = useStyles((t) => ({
 *     card: { backgroundColor: t.colors.surface },
 *   }));
 */
export function useStyles<
  T extends StyleSheet.NamedStyles<T> | StyleSheet.NamedStyles<unknown>,
>(factory: (theme: Theme) => T): T {
  const theme = useTheme();
  return useMemo(() => StyleSheet.create(factory(theme)), [theme, factory]);
}
