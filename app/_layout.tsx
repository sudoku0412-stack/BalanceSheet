import 'react-native-get-random-values';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as Notifications from 'expo-notifications';
import { useEffect, useState } from 'react';
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
  // Previously fire-and-forget — the rest of the app (Home's receipt
  // load, AuthContext's post-sign-in bootstrap) could start reading/
  // writing the DB before schema migrations in initDatabase() finished,
  // a latent race that got more likely to actually lose the more
  // migration statements got added over time (three new columns this
  // session alone). Gate rendering on it instead, same pattern as the
  // fontsLoaded check right below.
  const [dbReady, setDbReady] = useState(false);
  useEffect(() => {
    initDatabase()
      .catch(console.error)
      .finally(() => setDbReady(true));
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

  if (!fontsLoaded || !dbReady) {
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

// Routes the user reaches voluntarily (modals, edit screens). When
// `target` resolves to `(tabs)` and the user is on one of these, leave
// them alone — the guard's job is to force users to the auth gate, not
// to drag them back to /(tabs) every time they open a modal.
const STICKY_VOLUNTARY = new Set(['settings', 'edit', 'edit-profile', 'reports', 'balances', 'shared-expenses', 'recurring', 'households']);

function RootStack() {
  const theme = useTheme();
  const { initializing, user, onboardingSeen } = useAuth();
  const router = useRouter();
  const segments = useSegments();

  useEffect(() => {
    if (initializing) return;
    const current = (segments[0] ?? '') as string;
    const target = pickTarget({ user, onboardingSeen });
    if (target === current) return;
    // User is on a voluntary screen (modal / edit) and the gate state
    // says they're cleared for the app — leave them on it. We also
    // bail when `current` is empty: useSegments() can return [] for
    // top-level modal routes in some expo-router versions, and we
    // don't want the guard to force a redirect off an unknown route
    // just because we couldn't identify it.
    if (
      target === '(tabs)' &&
      (current === '' || STICKY_VOLUNTARY.has(current))
    ) {
      return;
    }
    // auth.tsx's "‹ Back to intro" link sends a signed-out user to
    // /onboarding voluntarily. Without this, pickTarget still resolves
    // to 'auth' (onboardingSeen is already true, so it doesn't route
    // to onboarding on its own) and this effect would immediately
    // replace back to /auth — the link would flash and bounce right
    // back, i.e. "not working". Signed-out + browsing onboarding again
    // is harmless; let them be until they act (Skip/Get Started, both
    // of which navigate onward themselves).
    if (target === 'auth' && current === 'onboarding') {
      return;
    }
    // A password-reset email deep-links a SIGNED-OUT user straight into
    // /reset-password (see lib/auth.ts's sendPasswordReset). pickTarget
    // resolves to 'auth' for anyone signed out, so without this the
    // guard would bounce them to /auth before they ever see the "set
    // new password" form — same flash-and-bounce as the onboarding case
    // above.
    if (target === 'auth' && current === 'reset-password') {
      return;
    }
    router.replace(targetToHref(target) as never);
  }, [initializing, user, onboardingSeen, segments]);

  // Shared-expense/settle-up pushes carry data.screen: 'balances' (see
  // lib/notifications.ts) — tapping one should jump straight to
  // Balances, not just foreground whatever screen the app was left on.
  // Covers both a cold-start tap (checked once here) and a tap while the
  // app was already running/backgrounded (the listener).
  useEffect(() => {
    if (initializing) return;
    const goToTargetScreen = (response: Notifications.NotificationResponse) => {
      const data = response.notification.request.content.data as { screen?: string } | undefined;
      if (data?.screen === 'balances') {
        router.push('/balances');
      }
    };
    Notifications.getLastNotificationResponseAsync().then((response) => {
      if (response) goToTargetScreen(response);
    });
    const subscription = Notifications.addNotificationResponseReceivedListener(goToTargetScreen);
    return () => subscription.remove();
  }, [initializing]);

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
        {/* NOT theme.colors.primary — dark navy on the near-black dark-mode
            background is invisible; accent has real contrast in both themes. */}
        <ActivityIndicator color={theme.colors.accent} size="large" />
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
      <Stack.Screen name="reset-password" options={{ headerShown: false }} />
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen
        name="settings"
        options={{
          title: 'Settings',
          // Regular stack screen, not a modal sheet — navigates like
          // every other page (slide transition + back chevron) instead
          // of popping up as a separate overlay.
          headerStyle: { backgroundColor: theme.colors.surface },
        }}
      />
      <Stack.Screen
        name="edit/[id]"
        options={{
          title: 'Edit Receipt',
          headerStyle: { backgroundColor: theme.colors.surface },
        }}
      />
      <Stack.Screen
        name="reports"
        options={{
          headerShown: false,
        }}
      />
      <Stack.Screen
        name="edit-profile"
        options={{
          headerShown: false,
        }}
      />
      <Stack.Screen
        name="balances"
        options={{
          headerShown: false,
        }}
      />
      <Stack.Screen
        name="recurring"
        options={{
          headerShown: false,
        }}
      />
      <Stack.Screen
        name="households"
        options={{
          headerShown: false,
        }}
      />
      <Stack.Screen
        name="shared-expenses/[uid]"
        options={{
          headerShown: false,
        }}
      />
    </Stack>
  );
}

