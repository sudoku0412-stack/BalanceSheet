import 'react-native-get-random-values';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useFonts } from 'expo-font';
import {
  Manrope_300Light,
  Manrope_500Medium,
  Manrope_700Bold,
  Manrope_800ExtraBold,
} from '@expo-google-fonts/manrope';
import {
  Roboto_100Thin,
  Roboto_300Light,
  Roboto_400Regular,
  Roboto_500Medium,
} from '@expo-google-fonts/roboto';
import { RobotoMono_400Regular, RobotoMono_500Medium } from '@expo-google-fonts/roboto-mono';
import { initDatabase } from '../lib/database';
import { ThemeProvider, useTheme } from '../constants/theme';
import { AuthProvider, useAuth } from '../lib/AuthContext';
import { ToastProvider } from '../components/ui/Toast';
import { pickTarget, targetToHref } from '../lib/routeGuard';

export default function RootLayout() {
  useEffect(() => {
    initDatabase().catch(console.error);
  }, []);

  const [fontsLoaded] = useFonts({
    Manrope_300Light,
    Manrope_500Medium,
    Manrope_700Bold,
    Manrope_800ExtraBold,
    Roboto_100Thin,
    Roboto_300Light,
    Roboto_400Regular,
    Roboto_500Medium,
    RobotoMono_400Regular,
    RobotoMono_500Medium,
  });

  if (!fontsLoaded) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#0C0F24' }}>
        <ActivityIndicator color="#fff" />
      </View>
    );
  }

  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <ToastProvider>
          <AuthProvider>
            <ThemedStatusBar />
            <RootStack />
          </AuthProvider>
        </ToastProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}

function ThemedStatusBar() {
  const theme = useTheme();
  // Light-content (white icons) on dark background; dark-content on light.
  return <StatusBar style={theme.isDark ? 'light' : 'dark'} />;
}

/**
 * Routes the user reaches voluntarily (modals, edit screens). When `target`
 * resolves to `(tabs)` and the user is on one of these, leave them alone —
 * the guard's job is to FORCE users to gate screens (auth, verify-email,
 * etc.), not to drag them back to /(tabs) every time they open a modal.
 *
 * Note: profile-setup lives here too because it's reused as an "edit
 * profile" destination from settings. When required at first sign-in,
 * pickTarget returns 'profile-setup' — so we still navigate there. When
 * voluntary, pickTarget returns '(tabs)' and we should leave them be.
 */
const STICKY_VOLUNTARY = new Set([
  'settings',
  'edit',
  'profile-setup',
  'category-detail',
  'reports',
]);

// Routes the guard must NEVER redirect away from, regardless of auth
// state. The invite-finish screen is reached via an app-link tap and
// runs its own create-account → sign-out → /auth flow; if the guard
// fires before that finishes it would yank the user to /auth without
// the email pre-fill or the success toast.
const NEVER_REDIRECT_FROM = new Set(['invite-finish', 'invite']);

function RootStack() {
  const theme = useTheme();
  const {
    initializing,
    user,
    emailVerified,
    requiresProfile,
    profileComplete,
    onboardingSeen,
    biometricEnabled,
    biometricAsked,
    biometricUnlocked,
  } = useAuth();
  const router = useRouter();
  const segments = useSegments();

  useEffect(() => {
    if (initializing) return;
    const current = (segments[0] ?? '') as string;
    const target = pickTarget({
      user,
      onboardingSeen,
      emailVerified,
      requiresProfile,
      profileComplete,
      biometricEnabled,
      biometricAsked,
      biometricUnlocked,
    });
    if (target === current) return;
    // Some screens own their own routing (e.g. invite-finish flows
    // unauthenticated user → /auth itself after signup). The guard
    // would otherwise see "no user → /auth" and yank the user off
    // mid-flow.
    if (NEVER_REDIRECT_FROM.has(current)) return;
    // User is on a voluntary screen (modal / edit) and the gate state
    // says they're cleared for the app — leave them on it. We also
    // bail when `current` is empty: useSegments() can return [] for
    // top-level modal routes in some expo-router versions, and we
    // don't want the guard to force a redirect off an unknown route
    // just because we couldn't identify it. Real redirects (sign out,
    // verify-email, etc.) flow through targets OTHER than '(tabs)',
    // so this only relaxes the "drag back to tabs" behavior.
    if (
      target === '(tabs)' &&
      (current === '' || STICKY_VOLUNTARY.has(current))
    ) {
      return;
    }
    router.replace(targetToHref(target) as never);
  }, [
    initializing,
    user,
    emailVerified,
    requiresProfile,
    profileComplete,
    onboardingSeen,
    biometricEnabled,
    biometricAsked,
    biometricUnlocked,
    segments,
  ]);

  if (initializing) {
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: theme.colors.background,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <ActivityIndicator color={theme.colors.primary} size="large" />
      </View>
    );
  }

  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: theme.colors.surface },
        headerTintColor: theme.colors.textPrimary,
        headerTitleStyle: { fontWeight: '700', color: theme.colors.textPrimary },
        contentStyle: { backgroundColor: theme.colors.background },
      }}
    >
      <Stack.Screen name="onboarding" options={{ headerShown: false }} />
      <Stack.Screen name="auth" options={{ headerShown: false }} />
      <Stack.Screen name="verify-email" options={{ headerShown: false, gestureEnabled: false }} />
      <Stack.Screen name="profile-setup" options={{ headerShown: false, gestureEnabled: false }} />
      <Stack.Screen name="biometric-setup" options={{ headerShown: false, gestureEnabled: false }} />
      <Stack.Screen name="lock" options={{ headerShown: false, gestureEnabled: false }} />
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen
        name="settings"
        options={{
          title: 'Settings',
          presentation: 'modal',
          headerStyle: { backgroundColor: theme.colors.surface },
        }}
      />
      <Stack.Screen
        name="edit/[id]"
        options={{
          title: 'Edit Receipt',
          // Regular stack screen (NOT modal). expo-router can't reliably
          // navigate from a modal (category-detail, reports) into another
          // modal — the new screen renders behind the active one. With
          // edit as a plain stack screen, push() works from anywhere.
          headerStyle: { backgroundColor: theme.colors.surface },
        }}
      />
      <Stack.Screen
        name="category-detail"
        options={{
          presentation: 'modal',
          headerShown: false,
        }}
      />
      <Stack.Screen
        name="reports"
        options={{
          presentation: 'modal',
          headerShown: false,
        }}
      />
    </Stack>
  );
}

