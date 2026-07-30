import React, { useEffect, useRef, useState } from 'react';
import {
  Alert,
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
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.header}>
            <View style={styles.brandRow}>
              <View style={styles.brandIcon}>
                <Ionicons name="receipt" size={18} color={theme.colors.textPrimary} />
              </View>
              <Text style={styles.brand}>Receiptly</Text>
            </View>
            <Text style={styles.title}>{tab === 'login' ? 'Welcome back' : 'Create your account'}</Text>
            <Text style={styles.tagline}>
              {tab === 'login'
                ? "Sign in to see where your money's going."
                : 'Start tracking every receipt in seconds.'}
            </Text>
          </View>

          <View style={styles.tabs}>
            <TabButton label="LOG IN" active={tab === 'login'} onPress={() => setTab('login')} />
            <TabButton label="SIGN UP" active={tab === 'signup'} onPress={() => setTab('signup')} />
          </View>

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

              <GoogleForm />
              <Button
                label="Continue with Phone"
                variant="secondary"
                onPress={() => setShowPhone(true)}
              />
            </>
          )}

          <Pressable onPress={() => router.replace('/onboarding')} hitSlop={8} style={styles.backRow}>
            <Ionicons name="chevron-back" size={14} color={theme.colors.textSecondary} />
            <Text style={styles.linkMuted}>Back to intro</Text>
          </Pressable>

          <Text style={styles.legal}>
            By continuing you agree to our Terms of Service and Privacy Policy.
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>
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
  const [email, setEmail] = useState(initialEmail ?? '');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    if (!email.trim() || !password) {
      Alert.alert('Missing info', 'Email and password are required.');
      return;
    }
    if (mode === 'signup' && password.length < 8) {
      Alert.alert('Weak password', 'Use at least 8 characters.');
      return;
    }
    try {
      setLoading(true);
      if (mode === 'login') {
        await signInWithEmail(email, password);
      } else {
        await signUpWithEmail(email, password);
      }
    } catch (e: any) {
      Alert.alert('Authentication failed', humanizeError(e));
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
      <Field
        label="Email"
        value={email}
        onChangeText={setEmail}
        placeholder="you@email.com"
        keyboardType="email-address"
        autoCapitalize="none"
        autoComplete="email"
      />
      <Field
        label="Password"
        value={password}
        onChangeText={setPassword}
        placeholder="••••••••"
        secureTextEntry
        autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
      />

      <Button
        label={mode === 'login' ? 'Log in' : 'Create account'}
        onPress={submit}
        loading={loading}
        size="lg"
        style={{ marginTop: theme.spacing.sm }}
      />

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
  const styles = useStyles(makeStyles);
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
    <View>
      <Text style={styles.helper}>
        Continue with your Google account. We only use your email and name.
      </Text>
      <Button
        label="Continue with Google"
        onPress={onPress}
        loading={loading}
        size="lg"
        style={{ marginTop: theme.spacing.md }}
      />
    </View>
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
  container: { flex: 1, backgroundColor: t.colors.background },
  scroll: {
    paddingHorizontal: t.spacing.lg,
    paddingTop: t.spacing.lg,
    paddingBottom: t.spacing.xl,
  },
  header: {
    alignItems: 'center' as const,
    marginBottom: t.spacing.xl,
  },
  brandRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: t.spacing.xs,
    marginBottom: t.spacing.md,
  },
  brandIcon: {
    width: 28,
    height: 28,
    borderRadius: t.radius.sm,
    backgroundColor: t.colors.surfaceHigh,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  brand: {
    color: t.colors.textPrimary,
    fontSize: t.font.lg,
    fontWeight: '700' as const,
  },
  title: {
    color: t.colors.textPrimary,
    fontSize: t.font.xxxl,
    fontWeight: '700' as const,
    marginBottom: t.spacing.xs,
  },
  tagline: {
    color: t.colors.textSecondary,
    fontSize: t.font.md,
    textAlign: 'center' as const,
  },
  tabs: {
    flexDirection: 'row' as const,
    backgroundColor: t.colors.surface,
    borderRadius: t.radius.md,
    padding: 4,
    marginBottom: t.spacing.lg,
  },
  tabBtn: {
    flex: 1,
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    paddingVertical: 10,
    borderRadius: t.radius.sm,
  },
  tabBtnActive: {
    backgroundColor: t.colors.primaryFaint,
  },
  tabBtnText: {
    color: t.colors.textSecondary,
    fontSize: t.font.sm,
    fontWeight: '600' as const,
  },
  tabBtnTextActive: {
    color: t.colors.primary,
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
    fontSize: t.font.xs,
    fontWeight: '600' as const,
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
    fontSize: t.font.sm,
    fontWeight: '600' as const,
    marginBottom: t.spacing.xs,
  },
  input: {
    backgroundColor: t.colors.background,
    color: t.colors.textPrimary,
    borderRadius: t.radius.md,
    paddingHorizontal: t.spacing.md,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: t.colors.border,
    fontSize: t.font.md,
  },
  linkMuted: {
    color: t.colors.textSecondary,
    fontSize: t.font.sm,
    fontWeight: '500' as const,
  },
  helper: {
    color: t.colors.textSecondary,
    fontSize: t.font.sm,
    marginBottom: t.spacing.md,
    lineHeight: 20,
  },
  legal: {
    color: t.colors.textMuted,
    fontSize: t.font.xs,
    textAlign: 'center' as const,
    marginTop: t.spacing.lg,
    paddingHorizontal: t.spacing.md,
    lineHeight: 16,
  },
});
