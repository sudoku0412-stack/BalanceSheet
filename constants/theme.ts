import React, { createContext, useContext, useMemo } from 'react';
import { StyleSheet, useColorScheme } from 'react-native';
import { Category } from '../types';

/**
 * Theme system. Light + dark palettes that mirror each other by shape,
 * keyed off the system color scheme via `useColorScheme()`. Components
 * that should react to theme changes use the `useTheme()` hook + a
 * useMemo'd `StyleSheet.create` block:
 *
 *   const theme = useTheme();
 *   const styles = useMemo(() => makeStyles(theme), [theme]);
 *
 * For backward compatibility there's still a default `theme` export
 * (dark palette) — older components that import it keep working but
 * won't update on system theme changes until they're migrated.
 */

// Brand colors shared across both palettes — a navy/periwinkle system:
// lavender-blue primary, teal-green secondary/success, muted red for
// alerts. Saturated enough to work on a dark background AND a light
// one without needing per-theme variants.
const BRAND = {
  primary: '#7B86D9',
  primaryDark: '#5B67C7',
  primaryLight: '#9AA3E8',
  secondary: '#4F9B82',
  success: '#4F9B82',
  watch: '#7B86D9',
  warning: '#D0A257',
  error: '#C2504F',
  info: '#5FA8C9',
};

const CATEGORY_COLORS = {
  Groceries: '#4F9B82',
  Electronics: '#7B86D9',
  Dining: '#6E7BDB',
  Pharmacy: '#B07BC9',
  Gas: '#7B86D9',
  Clothing: '#9AA3E8',
  Entertainment: '#B14B4B',
  Travel: '#5FA8C9',
  Healthcare: '#D06B6B',
  Other: '#6B7191', // slightly darker on light, still readable on dark
} as Record<Category, string>;

const SHAPE = {
  spacing: { xs: 4, sm: 8, md: 16, lg: 24, xl: 32, xxl: 48 },
  radius: { sm: 8, md: 12, lg: 16, xl: 24, full: 999 },
  font: { xs: 11, sm: 13, md: 15, lg: 17, xl: 20, xxl: 24, xxxl: 32 },
};

export const darkTheme = {
  isDark: true,
  colors: {
    background: '#0A0E27',
    surface: '#141936',
    surfaceHigh: '#1C2247',
    border: '#262C52',
    borderLight: '#363C6B',

    ...BRAND,
    primaryFaint: 'rgba(123, 134, 217, 0.16)',
    successFaint: 'rgba(79, 155, 130, 0.16)',
    errorFaint: 'rgba(194, 80, 79, 0.16)',

    textPrimary: '#F5F6FA',
    textSecondary: '#9AA0C3',
    textMuted: '#6B7191',

    category: CATEGORY_COLORS,
  },
  ...SHAPE,
};

export const lightTheme = {
  isDark: false,
  colors: {
    background: '#F4F5FB',
    surface: '#FFFFFF',
    surfaceHigh: '#ECEDF9',
    border: '#DBDDF0',
    borderLight: '#C6C9E8',

    ...BRAND,
    primaryFaint: 'rgba(91, 103, 199, 0.10)',
    successFaint: 'rgba(63, 143, 114, 0.10)',
    errorFaint: 'rgba(194, 80, 79, 0.10)',

    textPrimary: '#141936',
    textSecondary: '#4B5178',
    textMuted: '#8489AD',

    category: CATEGORY_COLORS,
  },
  ...SHAPE,
};

export type Theme = typeof darkTheme;

const ThemeContext = createContext<Theme>(darkTheme);

/**
 * Wrap the app's root in this provider. It listens to the system
 * color scheme via useColorScheme() and re-renders consumers when
 * the user toggles light/dark mode in their OS settings.
 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const scheme = useColorScheme();
  const value = useMemo(
    () => (scheme === 'light' ? lightTheme : darkTheme),
    [scheme],
  );
  return React.createElement(ThemeContext.Provider, { value }, children);
}

/** Returns the active theme (reactive — re-renders on system change). */
export function useTheme(): Theme {
  return useContext(ThemeContext);
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

