import React, { useEffect, useRef, useState } from 'react';
import {
  Alert,
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
import { router, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button } from '../components/ui/Button';
import { useToast } from '../components/ui/Toast';
import { Theme, useStyles, useTheme } from '../constants/theme';
import {
  ConfirmationResult,
  confirmPhoneCode,
  sendPasswordReset,
  signInWithEmail,
  signInWithGoogle,
  signInWithPhone,
  signUpWithEmail,
} from '../lib/auth';
import { humanizeAuthError } from '../lib/authErrors';

type Tab = 'login' | 'signup';

/**
 * Staggered fade+translateY entrance, per the design spec's timing
 * table (headline 40ms, subhead 80ms, tab 100ms, fields ~140ms,
 * submit 200ms, socials ~250ms).
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

export default function AuthScreen() {
  // Email pre-fill + success message come from the invite-finish
  // screen after a successful signup. Both are optional — when absent
  // this is just a normal /auth visit.
  const params = useLocalSearchParams<{ email?: string; msg?: string }>();
  const initialEmail = (params.email ?? '').trim();
  const initialMsg = (params.msg ?? '').trim();
  const [tab, setTab] = useState<Tab>('login');
  const [showPhone, setShowPhone] = useState(false);
  const theme = useTheme();
  const styles = useStyles(makeStyles);
  const toast = useToast();
  const toastShownRef = useRef(false);
  useEffect(() => {
    if (toastShownRef.current || !initialMsg) return;
    toastShownRef.current = true;
    toast.show({ kind: 'success', message: initialMsg });
  }, [initialMsg, toast]);

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
                <TabButton label="LOG IN" active={tab === 'login'} onPress={() => setTab('login')} />
                <TabButton label="SIGN UP" active={tab === 'signup'} onPress={() => setTab('signup')} />
              </View>
            </FadeInUp>

            {showPhone ? (
              <PhoneForm onUseEmail={() => setShowPhone(false)} />
            ) : (
              <>
                <EmailForm mode={tab} initialEmail={initialEmail} />

                <View style={styles.dividerRow}>
                  <View style={styles.dividerLine} />
                  <Text style={styles.dividerText}>OR</Text>
                  <View style={styles.dividerLine} />
                </View>

                <FadeInUp delay={250}>
                  <GoogleForm />
                </FadeInUp>
                <FadeInUp delay={260}>
                  <Button
                    label="Continue with Phone"
                    variant="secondary"
                    onPress={() => setShowPhone(true)}
                  />
                </FadeInUp>
              </>
            )}

            <Pressable onPress={() => router.replace('/onboarding')} hitSlop={8} style={styles.backRow}>
              <Ionicons name="chevron-back" size={14} color={theme.colors.textMuted} />
              <Text style={styles.linkMuted}>Back to intro</Text>
            </Pressable>

            <Text style={styles.legal}>
              By continuing you agree to our Terms of Service and Privacy Policy.
            </Text>
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

function EmailForm({ mode, initialEmail }: { mode: Tab; initialEmail?: string }) {
  const theme = useTheme();
  const styles = useStyles(makeStyles);
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState(initialEmail ?? '');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    setError(null);
    if (!email.trim() || !password) {
      setError('Email and password are required.');
      return;
    }
    if (mode === 'signup') {
      if (password.length < 8) {
        setError('Use at least 8 characters.');
        return;
      }
      if (password !== confirmPassword) {
        setError('Passwords do not match.');
        return;
      }
    }
    try {
      setLoading(true);
      if (mode === 'login') {
        await signInWithEmail(email, password);
      } else {
        // signUpWithEmail has no display-name param yet — fullName is
        // collected per the design spec but not persisted anywhere
        // until lib/auth.ts grows a way to save it (e.g. via a
        // follow-up updateProfile call). Not silently dropped: this
        // comment marks the gap for when that lands.
        await signUpWithEmail(email, password);
      }
    } catch (e: any) {
      setError(humanizeError(e));
    } finally {
      setLoading(false);
    }
  };

  const reset = async () => {
    if (!email.trim()) {
      Alert.alert('Enter your email first', 'We need an email to send the reset link to.');
      return;
    }
    try {
      await sendPasswordReset(email);
      Alert.alert('Reset link sent', 'Check your inbox to set a new password.');
    } catch (e: any) {
      Alert.alert('Could not send reset', humanizeError(e));
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
          label={mode === 'login' ? 'Log in' : 'Create account'}
          onPress={submit}
          loading={loading}
          size="lg"
          style={{ marginTop: theme.spacing.sm }}
        />
      </FadeInUp>

      {mode === 'login' && (
        <Pressable onPress={reset} hitSlop={8} style={styles.forgotRow}>
          <Text style={styles.linkMuted}>Forgot password?</Text>
        </Pressable>
      )}
    </View>
  );
}

function PhoneForm({ onUseEmail }: { onUseEmail: () => void }) {
  const theme = useTheme();
  const styles = useStyles(makeStyles);
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [confirmation, setConfirmation] = useState<ConfirmationResult | null>(null);
  const [loading, setLoading] = useState(false);

  const sendCode = async () => {
    const trimmed = phone.trim();
    if (!trimmed.startsWith('+')) {
      Alert.alert('Use international format', 'Phone must start with country code, e.g. +14155551234');
      return;
    }
    try {
      setLoading(true);
      const result = await signInWithPhone(trimmed);
      setConfirmation(result);
    } catch (e: any) {
      Alert.alert('Could not send code', humanizeError(e));
    } finally {
      setLoading(false);
    }
  };

  const verify = async () => {
    if (!confirmation) return;
    if (code.trim().length < 4) {
      Alert.alert('Enter the code', 'Check your SMS for the 6-digit code.');
      return;
    }
    try {
      setLoading(true);
      await confirmPhoneCode(confirmation, code);
    } catch (e: any) {
      Alert.alert('Verification failed', humanizeError(e));
    } finally {
      setLoading(false);
    }
  };

  if (!confirmation) {
    return (
      <View>
        <Field
          label="Phone number"
          value={phone}
          onChangeText={setPhone}
          placeholder="+14155551234"
          keyboardType="phone-pad"
          autoComplete="tel"
        />
        <Button
          label="Send code"
          onPress={sendCode}
          loading={loading}
          size="lg"
          style={{ marginTop: theme.spacing.md }}
        />
        <Pressable onPress={onUseEmail} hitSlop={8} style={{ marginTop: theme.spacing.md }}>
          <Text style={styles.linkMuted}>Use email instead</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View>
      <Text style={styles.helper}>We sent a code to {phone}.</Text>
      <Field
        label="Verification code"
        value={code}
        onChangeText={setCode}
        placeholder="123456"
        keyboardType="number-pad"
        autoComplete="sms-otp"
      />
      <Button
        label="Verify"
        onPress={verify}
        loading={loading}
        size="lg"
        style={{ marginTop: theme.spacing.md }}
      />
      <Pressable onPress={() => setConfirmation(null)} hitSlop={8} style={{ marginTop: theme.spacing.md }}>
        <Text style={styles.linkMuted}>Use a different number</Text>
      </Pressable>
    </View>
  );
}

function GoogleForm() {
  const theme = useTheme();
  const [loading, setLoading] = useState(false);

  const onPress = async () => {
    try {
      setLoading(true);
      await signInWithGoogle();
    } catch (e: any) {
      if (e?.code === 'SIGN_IN_CANCELLED') return;
      Alert.alert('Google sign-in failed', humanizeError(e));
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
      style={{ marginTop: theme.spacing.sm, marginBottom: theme.spacing.sm }}
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

const humanizeError = humanizeAuthError;

const makeStyles = (t: Theme) => ({
  root: { flex: 1, backgroundColor: t.colors.primary },
  navyHeader: {
    backgroundColor: t.colors.primary,
    paddingTop: 46,
    paddingBottom: 30,
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
    fontSize: t.font.sm,
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
  backRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    gap: 4,
    marginTop: t.spacing.lg,
  },
  forgotRow: {
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
  linkMuted: {
    color: t.colors.textSecondary,
    fontFamily: t.fonts.body.medium,
    fontSize: t.font.sm,
  },
  errorText: {
    color: t.colors.error,
    fontFamily: t.fonts.body.medium,
    fontSize: t.font.sm,
    marginBottom: t.spacing.sm,
  },
  helper: {
    color: t.colors.textSecondary,
    fontFamily: t.fonts.body.regular,
    fontSize: t.font.sm,
    marginBottom: t.spacing.md,
    lineHeight: 20,
  },
  legal: {
    color: t.colors.textMuted,
    fontFamily: t.fonts.body.regular,
    fontSize: t.font.xs,
    textAlign: 'center' as const,
    marginTop: t.spacing.lg,
    paddingHorizontal: t.spacing.md,
    lineHeight: 16,
  },
});
