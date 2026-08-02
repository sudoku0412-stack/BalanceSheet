import React, { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, Text, TextInput, View } from 'react-native';
import auth from '@react-native-firebase/auth';
import { router, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Theme, useStyles, useTheme } from '../constants/theme';
import { Button } from '../components/ui/Button';
import { useToast } from '../components/ui/Toast';
import { humanizeAuthError } from '../lib/authErrors';

/**
 * Landing screen for the password-reset deep link (see lib/auth.ts's
 * sendPasswordReset). Reached signed-out, straight from the email —
 * app/_layout.tsx's route guard has a specific allowance for this
 * route so it doesn't bounce to /auth before the form ever shows.
 * `oobCode` is Firebase's one-time proof that this request really
 * came from that email's inbox; confirmPasswordReset both validates
 * it AND sets the new password in one call (invalid/expired throws).
 */
export default function ResetPasswordScreen() {
  const theme = useTheme();
  const styles = useStyles(makeStyles);
  const toast = useToast();
  const { oobCode } = useLocalSearchParams<{ oobCode?: string }>();

  const [checking, setChecking] = useState(true);
  const [email, setEmail] = useState<string | null>(null);
  const [codeError, setCodeError] = useState<string | null>(null);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    (async () => {
      if (!oobCode) {
        setCodeError('This reset link is missing its code — open it directly from the email.');
        setChecking(false);
        return;
      }
      try {
        const verifiedEmail = await auth().verifyPasswordResetCode(oobCode);
        setEmail(verifiedEmail);
      } catch (e) {
        setCodeError(humanizeAuthError(e));
      } finally {
        setChecking(false);
      }
    })();
  }, [oobCode]);

  const submit = async () => {
    setFormError(null);
    if (password.length < 8) {
      setFormError('Password must be at least 8 characters.');
      return;
    }
    if (password !== confirmPassword) {
      setFormError('Passwords do not match.');
      return;
    }
    try {
      setSubmitting(true);
      await auth().confirmPasswordReset(oobCode!, password);
      toast.show({ kind: 'success', message: 'Password updated — sign in with your new password.' });
      router.replace('/auth');
    } catch (e) {
      setFormError(humanizeAuthError(e));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>Reset password</Text>

        {checking ? (
          <ActivityIndicator color={theme.colors.accent} style={{ marginTop: theme.spacing.lg }} />
        ) : codeError ? (
          <>
            <Text style={styles.errorText}>{codeError}</Text>
            <Button
              label="Back to sign in"
              onPress={() => router.replace('/auth')}
              size="lg"
              style={styles.submitButton}
            />
          </>
        ) : (
          <>
            <Text style={styles.subtitle}>Setting a new password for {email}</Text>

            <View style={styles.field}>
              <Text style={styles.fieldLabel}>New password</Text>
              <TextInput
                style={styles.input}
                value={password}
                onChangeText={setPassword}
                placeholder="••••••••"
                placeholderTextColor={theme.colors.textMuted}
                secureTextEntry
                autoComplete="new-password"
              />
            </View>
            <View style={styles.field}>
              <Text style={styles.fieldLabel}>Confirm new password</Text>
              <TextInput
                style={styles.input}
                value={confirmPassword}
                onChangeText={setConfirmPassword}
                placeholder="••••••••"
                placeholderTextColor={theme.colors.textMuted}
                secureTextEntry
                autoComplete="new-password"
              />
            </View>

            {formError && <Text style={styles.errorText}>{formError}</Text>}

            <Button
              label="Set new password"
              onPress={submit}
              loading={submitting}
              size="lg"
              style={styles.submitButton}
            />
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const makeStyles = (t: Theme) => ({
  root: { flex: 1, backgroundColor: t.colors.background },
  content: {
    flexGrow: 1,
    justifyContent: 'center' as const,
    paddingHorizontal: t.spacing.lg,
    paddingVertical: t.spacing.xl,
  },
  title: {
    color: t.colors.textPrimary,
    fontSize: t.font.xxl,
    fontFamily: t.fonts.display.extraBold,
    marginBottom: t.spacing.sm,
    textAlign: 'center' as const,
  },
  subtitle: {
    color: t.colors.textSecondary,
    fontSize: t.font.sm,
    fontFamily: t.fonts.body.regular,
    textAlign: 'center' as const,
    marginBottom: t.spacing.lg,
  },
  field: {
    marginBottom: t.spacing.md,
  },
  fieldLabel: {
    color: t.colors.textSecondary,
    fontSize: t.font.xs,
    fontFamily: t.fonts.display.bold,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.8,
    marginBottom: t.spacing.xs,
  },
  input: {
    color: t.colors.textPrimary,
    fontSize: t.font.md,
    backgroundColor: t.colors.surface,
    borderRadius: t.radius.lg,
    paddingHorizontal: t.spacing.md,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: t.colors.border,
  },
  errorText: {
    color: t.colors.error,
    fontSize: t.font.sm,
    fontFamily: t.fonts.body.regular,
    textAlign: 'center' as const,
    marginBottom: t.spacing.md,
  },
  submitButton: {
    marginTop: t.spacing.sm,
  },
});
