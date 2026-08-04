import React, { useEffect, useRef, useState } from 'react';
import { Alert, ScrollView, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Theme, useStyles, useTheme } from '../constants/theme';
import { ModalHeader } from '../components/ui/ModalHeader';
import { Button } from '../components/ui/Button';
import { useToast } from '../components/ui/Toast';
import { useAuth } from '../lib/AuthContext';
import { validateProfileDraft, isProfileValidationClean } from '../lib/profileValidation';
import { normalizePhoneE164 } from '../lib/phone';
import { setPhoneNumberManual, removePhoneVerification } from '../lib/phoneVerification';
import { getCurrentHouseholdId, setCurrentHouseholdId } from '../lib/database';

export default function EditProfileScreen() {
  const theme = useTheme();
  const styles = useStyles(makeStyles);
  const toast = useToast();
  const { user, profile, updateProfileName, refreshProfile } = useAuth();

  const [firstName, setFirstName] = useState(profile?.firstName ?? '');
  const [lastName, setLastName] = useState(profile?.lastName ?? '');
  const [phoneInput, setPhoneInput] = useState(profile?.phone ?? '');
  const [nameError, setNameError] = useState<string | null>(null);
  const [phoneError, setPhoneError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // `useState`'s initial value only applies on the very first render —
  // if `profile` from context is still null at that exact moment (not
  // yet loaded), the fields lock in empty forever with no re-sync when
  // it actually arrives. Hydrate once, the first time profile becomes
  // available, without re-running on every later profile change (which
  // would clobber whatever the user has typed since).
  const hydratedRef = useRef(false);
  useEffect(() => {
    if (profile && !hydratedRef.current) {
      hydratedRef.current = true;
      setFirstName(profile.firstName ?? '');
      setLastName(profile.lastName ?? '');
      setPhoneInput(profile.phone ?? '');
    }
  }, [profile]);

  const save = async () => {
    if (!user?.uid) return;
    const errors = validateProfileDraft({ firstName, lastName });
    if (!isProfileValidationClean(errors)) {
      setNameError(errors.firstName ?? errors.lastName ?? 'Check the name fields.');
      return;
    }
    setNameError(null);
    setPhoneError(null);

    const trimmedPhone = phoneInput.trim();
    let e164: string | null = null;
    if (trimmedPhone) {
      e164 = normalizePhoneE164(trimmedPhone);
      if (!e164) {
        setPhoneError('Enter a valid phone number, e.g. +1 416 555 1234.');
        return;
      }
    }

    setSaving(true);
    try {
      await updateProfileName(firstName.trim(), lastName.trim());

      if (e164 && e164 !== profile?.phone) {
        if (profile?.phone) await removePhoneVerification(user.uid, profile.phone);
        const result = await setPhoneNumberManual(user.uid, e164);
        if (result.joinedHouseholdId) {
          setCurrentHouseholdId(result.joinedHouseholdId);
        }
      } else if (!e164 && profile?.phone) {
        await removePhoneVerification(user.uid, profile.phone);
      }
      await refreshProfile();
      toast.show({ kind: 'success', message: 'Profile updated' });
      router.back();
    } catch (e) {
      Alert.alert('Save failed', (e as Error)?.message ?? 'Try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <ModalHeader title="Edit Profile" />
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.label}>First name</Text>
        <TextInput
          value={firstName}
          onChangeText={setFirstName}
          placeholder="Jane"
          placeholderTextColor={theme.colors.textMuted}
          autoCapitalize="words"
          style={styles.input}
        />

        <Text style={styles.label}>Last name</Text>
        <TextInput
          value={lastName}
          onChangeText={setLastName}
          placeholder="Doe"
          placeholderTextColor={theme.colors.textMuted}
          autoCapitalize="words"
          style={styles.input}
        />
        {nameError && <Text style={styles.errorText}>{nameError}</Text>}

        <Text style={styles.label}>Phone number</Text>
        <TextInput
          value={phoneInput}
          onChangeText={setPhoneInput}
          placeholder="+1 416 555 1234"
          placeholderTextColor={theme.colors.textMuted}
          keyboardType="phone-pad"
          style={styles.input}
        />
        {phoneError && <Text style={styles.errorText}>{phoneError}</Text>}
        <Text style={styles.hint}>
          Optional — lets others add you to a household by phone number.
        </Text>

        <Button label="Save" onPress={save} loading={saving} size="lg" style={styles.saveBtn} />
      </ScrollView>
    </SafeAreaView>
  );
}

const makeStyles = (theme: Theme) => ({
  root: { flex: 1, backgroundColor: theme.colors.background },
  content: {
    paddingHorizontal: theme.spacing.lg,
    paddingTop: theme.spacing.md,
    paddingBottom: theme.spacing.xl,
  },
  label: {
    color: theme.colors.textSecondary,
    fontSize: theme.font.xs,
    fontFamily: theme.fonts.display.bold,
    letterSpacing: 1,
    textTransform: 'uppercase' as const,
    marginTop: theme.spacing.md,
    marginBottom: theme.spacing.sm,
  },
  input: {
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radius.lg,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: 12,
    color: theme.colors.textPrimary,
    fontSize: theme.font.md,
    fontFamily: theme.fonts.body.regular,
    backgroundColor: theme.colors.surface,
  },
  errorText: {
    color: theme.colors.error,
    fontSize: theme.font.xs,
    fontFamily: theme.fonts.body.regular,
    marginTop: 6,
  },
  hint: {
    color: theme.colors.textMuted,
    fontSize: theme.font.xs,
    fontFamily: theme.fonts.body.regular,
    marginTop: 6,
  },
  saveBtn: {
    marginTop: theme.spacing.xl,
  },
});
