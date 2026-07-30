import React, { useEffect, useRef, useState } from 'react';
import {
  Animated,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button } from '../components/ui/Button';
import { useToast } from '../components/ui/Toast';
import { Theme, useStyles, useTheme } from '../constants/theme';
import { useAuth } from '../lib/AuthContext';
import {
  signInAsGuest,
  signInWithEmail,
  signInWithGoogle,
  signUpWithEmail,
} from '../lib/auth';
import { humanizeAuthError } from '../lib/authErrors';

type Tab = 'login' | 'signup';

/**
 * Staggered fade+translateY entrance, per the design spec's timing
 * table (headline 40ms, subhead 80ms, tab 100ms, fields ~120-180ms,
 * submit 200ms, socials ~240-260ms).
 */
function FadeInUp({ delay, children }: { delay: number; children: React.ReactNode }) {
  const anim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(anim, {
      toValue: 1,
      duration: 300,
      delay,
      useNativeDriver: true,
    }).start();
  }, [anim, delay]);
  return (
    <Animated.View
      style={{
        opacity: anim,
        transform: [{ translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [10, 0] }) }],
      }}
    >
      {children}
    </Animated.View>
  );
}

/** Split a "Full name" input into (firstName, lastName) on the first space. */
function splitName(fullName: string): { firstName: string; lastName: string } {
  const trimmed = fullName.trim();
  const idx = trimmed.indexOf(' ');
  if (idx === -1) return { firstName: trimmed, lastName: '' };
  return { firstName: trimmed.slice(0, idx), lastName: trimmed.slice(idx + 1).trim() };
}

export default function AuthScreen() {
  const [tab, setTab] = useState<Tab>('login');
  const theme = useTheme();
  const styles = useStyles(makeStyles);
  const toast = useToast();

  const onGuest = async () => {
    try {
      await signInAsGuest();
    } catch (e: any) {
      toast.show({ kind: 'error', message: humanizeAuthError(e) });
    }
  };

  return (
    <SafeAreaView style={styles.root} edges={['bottom']}>
      <View style={styles.navyHeader}>
        <View style={styles.decorCircleLg} />
        <View style={styles.decorCircleSm} />
        <FadeInUp delay={0}>
          <View style={styles.brandRow}>
            <View style={styles.brandIcon}>
              <Ionicons name="receipt" size={16} color={theme.colors.primary} />
            </View>
            <Text style={styles.brand}>
              <Text style={styles.brandBold}>Receipt</Text>
              <Text style={styles.brandLight}>ly</Text>
            </Text>
          </View>
        </FadeInUp>
        <FadeInUp delay={40}>
          <Text style={styles.headline}>
            {tab === 'login' ? 'Welcome back' : 'Create your account'}
          </Text>
        </FadeInUp>
        <FadeInUp delay={80}>
          <Text style={styles.subhead}>
            {tab === 'login'
              ? "Sign in to see where your money's going."
              : 'Start tracking every receipt in seconds.'}
          </Text>
        </FadeInUp>
      </View>

      <View style={styles.sheet}>
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <ScrollView
            contentContainerStyle={styles.scroll}
            keyboardShouldPersistTaps="handled"
          >
            <FadeInUp delay={100}>
              <View style={styles.tabs}>
                <TabButton label="Log In" active={tab === 'login'} onPress={() => setTab('login')} />
                <TabButton label="Sign Up" active={tab === 'signup'} onPress={() => setTab('signup')} />
              </View>
            </FadeInUp>

            <EmailForm mode={tab} />

            <View style={styles.dividerRow}>
              <View style={styles.dividerLine} />
              <Text style={styles.dividerText}>OR</Text>
              <View style={styles.dividerLine} />
            </View>

            <FadeInUp delay={240}>
              <GoogleForm />
            </FadeInUp>
            <FadeInUp delay={260}>
              <AppleButton />
            </FadeInUp>

            <Pressable onPress={onGuest} hitSlop={8} style={styles.guestRow}>
              <Text style={styles.linkAccent}>Continue as guest</Text>
            </Pressable>

            <Pressable onPress={() => router.replace('/onboarding')} hitSlop={8} style={styles.backRow}>
              <Text style={styles.linkMuted}>‹ Back to intro</Text>
            </Pressable>
          </ScrollView>
        </KeyboardAvoidingView>
      </View>
    </SafeAreaView>
  );
}

function TabButton({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  const styles = useStyles(makeStyles);
  return (
    <Pressable
      onPress={onPress}
      style={[styles.tabBtn, active && styles.tabBtnActive]}
    >
      <Text style={[styles.tabBtnText, active && styles.tabBtnTextActive]}>{label}</Text>
    </Pressable>
  );
}

function EmailForm({ mode }: { mode: Tab }) {
  const theme = useTheme();
  const styles = useStyles(makeStyles);
  const { ensureProfile } = useAuth();
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    setError(null);
    if (mode === 'signup' && !fullName.trim()) {
      setError('Full name is required.');
      return;
    }
    if (!email.trim() || !password) {
      setError('Email and password are required.');
      return;
    }
    if (mode === 'signup' && password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }
    try {
      setLoading(true);
      if (mode === 'login') {
        await signInWithEmail(email, password);
      } else {
        await signUpWithEmail(email, password);
        const { firstName, lastName } = splitName(fullName);
        await ensureProfile(firstName, lastName);
      }
    } catch (e: any) {
      setError(humanizeAuthError(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <View>
      {mode === 'signup' && (
        <FadeInUp delay={120}>
          <Field
            label="Full name"
            value={fullName}
            onChangeText={setFullName}
            placeholder="Jane Doe"
            autoCapitalize="words"
          />
        </FadeInUp>
      )}
      <FadeInUp delay={140}>
        <Field
          label="Email"
          value={email}
          onChangeText={setEmail}
          placeholder="you@email.com"
          keyboardType="email-address"
          autoCapitalize="none"
          autoComplete="email"
        />
      </FadeInUp>
      <FadeInUp delay={160}>
        <Field
          label="Password"
          value={password}
          onChangeText={setPassword}
          placeholder="••••••••"
          secureTextEntry
          autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
        />
      </FadeInUp>
      {mode === 'signup' && (
        <FadeInUp delay={180}>
          <Field
            label="Confirm password"
            value={confirmPassword}
            onChangeText={setConfirmPassword}
            placeholder="••••••••"
            secureTextEntry
            autoComplete="new-password"
          />
        </FadeInUp>
      )}

      {error && <Text style={styles.errorText}>{error}</Text>}

      <FadeInUp delay={200}>
        <Button
          label={mode === 'login' ? 'Log In' : 'Create Account'}
          onPress={submit}
          loading={loading}
          size="lg"
          style={{ ...styles.submitButton, marginTop: theme.spacing.sm }}
        />
      </FadeInUp>
    </View>
  );
}

function GoogleForm() {
  const { ensureProfile } = useAuth();
  const styles = useStyles(makeStyles);
  const toast = useToast();
  const [loading, setLoading] = useState(false);

  const onPress = async () => {
    try {
      setLoading(true);
      const googleUser = await signInWithGoogle();
      const displayName = googleUser.displayName ?? '';
      const parts = displayName.split(' ').filter(Boolean);
      await ensureProfile(parts[0] ?? '', parts.slice(1).join(' '));
    } catch (e: any) {
      if (e?.code === 'SIGN_IN_CANCELLED') return;
      toast.show({ kind: 'error', message: humanizeAuthError(e) });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Button
      label="Continue with Google"
      onPress={onPress}
      loading={loading}
      variant="secondary"
      style={styles.socialButton}
      textStyle={styles.socialButtonText}
    />
  );
}

function AppleButton() {
  const toast = useToast();
  const styles = useStyles(makeStyles);

  const onPress = () => {
    toast.show({ kind: 'info', message: "Apple sign-in isn't available yet" });
  };

  return (
    <Button
      label="Continue with Apple"
      onPress={onPress}
      variant="secondary"
      style={{ ...styles.socialButton, marginTop: 0 }}
      textStyle={styles.socialButtonText}
    />
  );
}

function Field({
  label,
  ...input
}: { label: string } & React.ComponentProps<typeof TextInput>) {
  const theme = useTheme();
  const styles = useStyles(makeStyles);
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        {...input}
        placeholderTextColor={theme.colors.textMuted}
        style={styles.input}
      />
    </View>
  );
}

const makeStyles = (t: Theme) => ({
  root: { flex: 1, backgroundColor: t.colors.primary },
  navyHeader: {
    backgroundColor: t.colors.primary,
    paddingTop: 46,
    paddingBottom: 38,
    paddingHorizontal: t.spacing.lg,
    overflow: 'hidden' as const,
  },
  decorCircleLg: {
    position: 'absolute' as const,
    top: -50,
    right: -40,
    width: 160,
    height: 160,
    borderRadius: t.radius.full,
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  decorCircleSm: {
    position: 'absolute' as const,
    top: 20,
    right: 40,
    width: 70,
    height: 70,
    borderRadius: t.radius.full,
    backgroundColor: 'rgba(255,255,255,0.05)',
  },
  brandRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: t.spacing.xs,
    marginBottom: t.spacing.lg,
  },
  brandIcon: {
    width: 26,
    height: 26,
    borderRadius: t.radius.sm,
    backgroundColor: '#fff',
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  brand: { fontSize: t.font.md },
  brandBold: { color: '#fff', fontFamily: t.fonts.display.extraBold },
  brandLight: { color: '#fff', fontFamily: t.fonts.display.light },
  headline: {
    color: '#fff',
    fontFamily: t.fonts.display.extraBold,
    fontSize: 30,
  },
  subhead: {
    color: 'rgba(255,255,255,0.65)',
    fontFamily: t.fonts.body.regular,
    fontSize: 14,
    marginTop: 4,
  },
  sheet: {
    flex: 1,
    backgroundColor: t.colors.surface,
    borderTopLeftRadius: t.radius.xl,
    borderTopRightRadius: t.radius.xl,
    marginTop: -16,
  },
  scroll: {
    paddingHorizontal: t.spacing.lg,
    paddingTop: t.spacing.lg,
    paddingBottom: t.spacing.xl,
  },
  tabs: {
    flexDirection: 'row' as const,
    backgroundColor: t.colors.surfaceHigh,
    borderRadius: t.radius.sm,
    padding: 4,
    marginBottom: t.spacing.lg,
  },
  tabBtn: {
    flex: 1,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    paddingVertical: 10,
    borderRadius: t.radius.sm,
  },
  tabBtnActive: {
    backgroundColor: t.colors.primary,
  },
  tabBtnText: {
    color: t.colors.textSecondary,
    fontFamily: t.fonts.display.bold,
    fontSize: t.font.sm,
  },
  tabBtnTextActive: {
    color: '#fff',
  },
  dividerRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: t.spacing.sm,
    marginVertical: t.spacing.lg,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: t.colors.border,
  },
  dividerText: {
    color: t.colors.textMuted,
    fontFamily: t.fonts.display.bold,
    fontSize: t.font.xs,
  },
  guestRow: {
    alignItems: 'center' as const,
    marginTop: t.spacing.lg,
  },
  backRow: {
    alignItems: 'center' as const,
    marginTop: t.spacing.md,
  },
  field: {
    marginBottom: t.spacing.md,
  },
  fieldLabel: {
    color: t.colors.textSecondary,
    fontFamily: t.fonts.display.medium,
    fontSize: t.font.sm,
    marginBottom: t.spacing.xs,
  },
  input: {
    backgroundColor: t.colors.background,
    color: t.colors.textPrimary,
    fontFamily: t.fonts.body.regular,
    borderRadius: t.radius.sm,
    paddingHorizontal: t.spacing.md,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: t.colors.border,
    fontSize: t.font.md,
  },
  submitButton: {
    height: 50,
    justifyContent: 'center' as const,
  },
  socialButton: {
    height: 46,
    justifyContent: 'center' as const,
    marginTop: t.spacing.sm,
  },
  socialButtonText: {
    textTransform: 'none' as const,
  },
  linkAccent: {
    color: t.colors.accent,
    fontFamily: t.fonts.body.medium,
    fontSize: t.font.sm,
  },
  linkMuted: {
    color: t.colors.textMuted,
    fontFamily: t.fonts.body.medium,
    fontSize: t.font.sm,
  },
  errorText: {
    color: t.colors.error,
    fontFamily: t.fonts.body.medium,
    fontSize: t.font.sm,
    marginBottom: t.spacing.sm,
  },
});
