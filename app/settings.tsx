import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as FileSystem from 'expo-file-system';
import { useStyles, useTheme } from '../constants/theme';
import { Button } from '../components/ui/Button';
import { ALL_CATEGORIES } from '../constants/categories';
import { useAuth } from '../lib/AuthContext';
import { humanizeAuthError } from '../lib/authErrors';
import { classifyWithAnthropic } from '../lib/anthropicClassify';
import {
  getAiClassifyEnabled,
  getAnthropicApiKey,
  getBudgetAlertsEnabled,
  getCategoryBudgets,
  getGeminiApiKey,
  setAiClassifyEnabled,
  setAnthropicApiKey,
  setBudgetAlertsEnabled as persistBudgetAlertsEnabled,
  setCategoryBudget,
  setGeminiApiKey,
} from '../lib/secureStorage';
import { parseReceiptWithGemini } from '../lib/geminiParseReceipt';
import {
  getCloudSyncDiagnostics,
  getHouseholdMembers,
  inviteUserToHousehold,
  leaveCurrentHousehold,
  subscribeCloudSyncDiagnostics,
  type HouseholdMember,
} from '../lib/cloudSync';
import {
  rememberPendingInviteEmail,
  sendInviteEmailLink,
} from '../lib/inviteLink';
import {
  setCurrentHouseholdId,
  getCurrentHouseholdId,
  getAllReceipts,
} from '../lib/database';
import { receiptsToCsv } from '../lib/reports';
import { Category } from '../types';

function useSettingsStyles() {
  return useStyles((theme) => ({
    container: { flex: 1, backgroundColor: theme.colors.background },
    scroll: {
      paddingHorizontal: theme.spacing.lg,
      paddingTop: theme.spacing.lg,
      paddingBottom: theme.spacing.xl,
    },
    screenTitle: {
      color: theme.colors.textPrimary,
      fontSize: theme.font.xxxl,
      fontFamily: theme.fonts.display.extraBold,
      marginBottom: theme.spacing.lg,
    },
    section: {
      marginBottom: theme.spacing.lg,
    },
    sectionTitle: {
      color: theme.colors.textSecondary,
      fontSize: theme.font.xs,
      fontFamily: theme.fonts.display.bold,
      letterSpacing: 1,
      textTransform: 'uppercase',
      marginBottom: theme.spacing.sm,
      paddingHorizontal: theme.spacing.xs,
    },
    card: {
      backgroundColor: theme.colors.surface,
      borderRadius: theme.radius.lg,
      borderWidth: 1,
      borderColor: theme.colors.border,
      overflow: 'hidden',
    },
    row: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingHorizontal: theme.spacing.md,
      paddingVertical: 14,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.colors.border,
    },
    rowLabel: {
      color: theme.colors.textSecondary,
      fontSize: theme.font.sm,
      fontFamily: theme.fonts.body.regular,
    },
    rowValue: {
      color: theme.colors.textPrimary,
      fontSize: theme.font.sm,
      fontFamily: theme.fonts.body.medium,
      maxWidth: '60%',
    },
    linkRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingHorizontal: theme.spacing.md,
      paddingVertical: 14,
    },
    linkText: {
      color: theme.colors.accent,
      fontSize: theme.font.md,
      fontFamily: theme.fonts.display.bold,
    },
    profileHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: theme.spacing.md,
      paddingVertical: theme.spacing.md,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.colors.border,
    },
    avatar: {
      width: 48,
      height: 48,
      borderRadius: theme.radius.full,
      borderWidth: 1,
      borderColor: theme.colors.border,
    },
    avatarPlaceholder: {
      backgroundColor: theme.colors.primary,
      alignItems: 'center',
      justifyContent: 'center',
    },
    avatarInitials: {
      color: '#FFFFFF',
      fontSize: theme.font.md,
      fontFamily: theme.fonts.display.bold,
    },
    profileName: {
      color: theme.colors.textPrimary,
      fontSize: theme.font.lg,
      fontFamily: theme.fonts.display.bold,
    },
    profileMeta: {
      color: theme.colors.textMuted,
      fontSize: theme.font.sm,
      fontFamily: theme.fonts.body.regular,
      marginTop: 2,
    },
    signOutTextBtn: {
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: theme.spacing.md,
    },
    signOutTextLabel: {
      color: theme.colors.error,
      fontSize: theme.font.md,
      fontFamily: theme.fonts.display.bold,
    },
    dangerZone: {
      marginTop: theme.spacing.md,
    },
    deleteBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      backgroundColor: theme.colors.errorFaint,
      borderRadius: theme.radius.md,
      paddingVertical: 14,
      marginTop: theme.spacing.md,
      borderWidth: 1,
      borderColor: theme.colors.error,
    },
    deleteText: {
      color: theme.colors.error,
      fontSize: theme.font.md,
      fontFamily: theme.fonts.display.bold,
    },
    deleteHelp: {
      color: theme.colors.textMuted,
      fontSize: theme.font.xs,
      fontFamily: theme.fonts.body.regular,
      textAlign: 'center',
      marginTop: theme.spacing.sm,
      paddingHorizontal: theme.spacing.md,
      lineHeight: 16,
    },
    keyBlock: {
      paddingHorizontal: theme.spacing.md,
      paddingVertical: theme.spacing.md,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: theme.colors.border,
    },
    keyLabel: {
      color: theme.colors.textSecondary,
      fontSize: theme.font.xs,
      fontFamily: theme.fonts.display.medium,
      marginBottom: 6,
    },
    keyRow: {
      flexDirection: 'row',
      alignItems: 'center',
    },
    keyInput: {
      flex: 1,
      backgroundColor: theme.colors.background,
      color: theme.colors.textPrimary,
      borderRadius: theme.radius.sm,
      paddingHorizontal: theme.spacing.md,
      paddingVertical: 10,
      borderWidth: 1,
      borderColor: theme.colors.border,
      fontSize: theme.font.sm,
      fontFamily: theme.fonts.mono.regular,
    },
    keyButtons: {
      flexDirection: 'row',
      gap: theme.spacing.sm,
      marginTop: theme.spacing.sm,
    },
    keyButton: {
      flex: 1,
      alignItems: 'center',
      backgroundColor: theme.colors.primary,
      borderRadius: theme.radius.sm,
      paddingVertical: 10,
    },
    keyButtonGhost: {
      backgroundColor: 'transparent',
      borderWidth: 1,
      borderColor: theme.colors.border,
    },
    keyButtonText: {
      color: '#fff',
      fontSize: theme.font.sm,
      fontFamily: theme.fonts.display.bold,
    },
    keyButtonGhostText: {
      color: theme.colors.textPrimary,
    },
    keyHelp: {
      color: theme.colors.textMuted,
      fontSize: theme.font.xs,
      fontFamily: theme.fonts.body.regular,
      lineHeight: 16,
      marginTop: theme.spacing.sm,
    },
    budgetRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: theme.spacing.md,
      paddingVertical: 12,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.colors.border,
      gap: theme.spacing.sm,
    },
    categoryDot: {
      width: 10,
      height: 10,
      borderRadius: theme.radius.full,
    },
    categoryName: {
      flex: 1,
      color: theme.colors.textPrimary,
      fontSize: theme.font.md,
      fontFamily: theme.fonts.display.bold,
    },
    budgetInputBox: {
      flexDirection: 'row',
      alignItems: 'center',
      borderWidth: 1,
      borderColor: theme.colors.border,
      borderRadius: theme.radius.full,
      paddingHorizontal: theme.spacing.sm,
      paddingVertical: 6,
      backgroundColor: theme.colors.background,
    },
    budgetCurrencyPrefix: {
      color: theme.colors.textMuted,
      fontSize: theme.font.sm,
      fontFamily: theme.fonts.mono.regular,
      marginRight: 2,
    },
    budgetInput: {
      color: theme.colors.textPrimary,
      fontSize: theme.font.sm,
      fontFamily: theme.fonts.mono.medium,
      minWidth: 44,
      padding: 0,
      textAlign: 'right',
    },
    alertRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: theme.spacing.md,
      paddingVertical: 14,
    },
    alertLabel: {
      color: theme.colors.textPrimary,
      fontSize: theme.font.md,
      fontFamily: theme.fonts.display.bold,
    },
    alertCaption: {
      color: theme.colors.textMuted,
      fontSize: theme.font.xs,
      fontFamily: theme.fonts.body.regular,
      marginTop: 2,
    },
    budgetAlertsSwitch: {
      // Native Switch has no width/height props — the design spec calls
      // for a 40x24px pill, close to the default ~51x31 control, so we
      // scale it down instead of reimplementing a custom pill toggle.
      transform: [{ scaleX: 0.8 }, { scaleY: 0.8 }],
    },
  }));
}

export default function SettingsScreen() {
  const theme = useTheme();
  const styles = useSettingsStyles();
  const { user, profile, provider, biometricEnabled, setBiometricEnabled, signOut, deleteAccount } =
    useAuth();
  const [working, setWorking] = useState(false);

  const [aiEnabled, setAiEnabledState] = useState(false);
  const [apiKey, setApiKeyState] = useState('');
  const [keyVisible, setKeyVisible] = useState(false);
  const [savingKey, setSavingKey] = useState(false);
  const [testingKey, setTestingKey] = useState(false);

  const [geminiKey, setGeminiKeyState] = useState('');
  const [geminiVisible, setGeminiVisible] = useState(false);
  const [savingGemini, setSavingGemini] = useState(false);
  const [testingGemini, setTestingGemini] = useState(false);

  // Per-category budget amounts and the "notify near limit" toggle are
  // persisted via lib/secureStorage (getCategoryBudgets/setCategoryBudget,
  // getBudgetAlertsEnabled/setBudgetAlertsEnabled) — the same store the
  // dashboard reads from to render the Budgets section and status pills.
  const [categoryBudgets, setCategoryBudgets] = useState<Record<string, string>>({});
  const [budgetAlertsEnabled, setBudgetAlertsEnabledState] = useState(true);
  const [exportingAll, setExportingAll] = useState(false);

  useEffect(() => {
    let mounted = true;
    (async () => {
      const [stored, enabled, gemini, budgets, alertsEnabled] = await Promise.all([
        getAnthropicApiKey(),
        getAiClassifyEnabled(),
        getGeminiApiKey(),
        getCategoryBudgets(),
        getBudgetAlertsEnabled(),
      ]);
      if (!mounted) return;
      setApiKeyState(stored ?? '');
      setAiEnabledState(enabled);
      setGeminiKeyState(gemini ?? '');
      setCategoryBudgets(
        Object.fromEntries(
          Object.entries(budgets).map(([cat, amount]) => [cat, String(amount)]),
        ),
      );
      setBudgetAlertsEnabledState(alertsEnabled);
    })();
    return () => {
      mounted = false;
    };
  }, []);

  const updateCategoryBudget = (cat: string, value: string) => {
    setCategoryBudgets((prev) => ({ ...prev, [cat]: value }));
    const parsed = parseFloat(value);
    if (!Number.isNaN(parsed) && parsed >= 0) {
      setCategoryBudget(cat, parsed);
    }
  };

  const toggleBudgetAlerts = (enabled: boolean) => {
    setBudgetAlertsEnabledState(enabled);
    persistBudgetAlertsEnabled(enabled);
  };

  const toggleAi = async () => {
    if (!aiEnabled && !apiKey.trim()) {
      Alert.alert(
        'Add your API key first',
        'Paste an Anthropic API key below, then turn this on.',
      );
      return;
    }
    const next = !aiEnabled;
    await setAiClassifyEnabled(next);
    setAiEnabledState(next);
  };

  const saveKey = async () => {
    setSavingKey(true);
    try {
      await setAnthropicApiKey(apiKey.trim() || null);
      Alert.alert(
        apiKey.trim() ? 'Key saved' : 'Key removed',
        apiKey.trim()
          ? 'Stored on this device only. It never appears in the app bundle.'
          : 'Anthropic key cleared from this device.',
      );
    } catch (e) {
      Alert.alert('Could not save key', (e as Error)?.message ?? 'Try again.');
    } finally {
      setSavingKey(false);
    }
  };

  const testKey = async () => {
    if (!apiKey.trim()) {
      Alert.alert('Add a key first', 'Paste an Anthropic API key, save it, then test.');
      return;
    }
    setTestingKey(true);
    try {
      const result = await classifyWithAnthropic('Organic Whole Milk 2%', apiKey.trim());
      if (result.ok) {
        Alert.alert(
          'Connection works',
          `Anthropic classified "Organic Whole Milk 2%" as ${result.category}.`,
        );
      } else {
        Alert.alert('Connection failed', result.error);
      }
    } finally {
      setTestingKey(false);
    }
  };

  const saveGeminiKey = async () => {
    setSavingGemini(true);
    try {
      await setGeminiApiKey(geminiKey.trim() || null);
      Alert.alert(
        geminiKey.trim() ? 'Gemini key saved' : 'Gemini key removed',
        geminiKey.trim()
          ? 'Stored encrypted on this device only. Used for full-receipt parsing instead of the shared free tier.'
          : 'Gemini key cleared — scans will go back to the shared free tier / Cloudflare fallback.',
      );
    } catch (e) {
      Alert.alert('Could not save key', (e as Error)?.message ?? 'Try again.');
    } finally {
      setSavingGemini(false);
    }
  };

  const testGeminiKey = async () => {
    if (!geminiKey.trim()) {
      Alert.alert('Add a key first', 'Paste a Gemini API key, save it, then test.');
      return;
    }
    setTestingGemini(true);
    try {
      const result = await parseReceiptWithGemini(
        'TEST STORE\nMILK 3.99\nSUBTOTAL 3.99\nTAX 0.39\nTOTAL 4.38',
        geminiKey.trim(),
      );
      if (result.ok) {
        Alert.alert(
          'Connection works',
          `Gemini parsed a test receipt as ${result.receipt.storeName} for $${result.receipt.totalAmount.toFixed(2)}.`,
        );
      } else {
        Alert.alert('Connection failed', result.error);
      }
    } finally {
      setTestingGemini(false);
    }
  };

  /**
   * Exports every receipt on this device/household as a single CSV —
   * reuses the same `getAllReceipts` + `receiptsToCsv` + share-sheet
   * pattern already proven out in Reports' date-range export
   * (app/reports.tsx), just without the date filter. Lazily requires
   * expo-sharing so this doesn't crash on an APK where the native
   * module isn't linked yet; falls back to reporting the saved path.
   */
  const exportAllData = async () => {
    if (exportingAll) return;
    setExportingAll(true);
    try {
      const receipts = await getAllReceipts();
      if (receipts.length === 0) {
        Alert.alert('Nothing to export', 'Scan a few receipts before exporting.');
        return;
      }
      const csv = receiptsToCsv(receipts);
      const filename = `BalanceSheet All Data - ${new Date().toISOString().slice(0, 10)}.csv`;
      const path = `${FileSystem.documentDirectory}${filename}`;
      await FileSystem.writeAsStringAsync(path, csv, {
        encoding: FileSystem.EncodingType.UTF8,
      });

      let Sharing: typeof import('expo-sharing') | null = null;
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports, global-require
        Sharing = require('expo-sharing');
      } catch {
        Sharing = null;
      }
      const canShare = Sharing
        ? await Sharing.isAvailableAsync().catch(() => false)
        : false;
      if (Sharing && canShare) {
        await Sharing.shareAsync(path, {
          mimeType: 'text/csv',
          dialogTitle: 'Export all data',
          UTI: 'public.comma-separated-values-text',
        });
      } else {
        Alert.alert(
          'Saved',
          `Sharing isn't available in this build, but the file was written to ${path}.`,
        );
      }
    } catch (e) {
      Alert.alert('Export failed', (e as Error)?.message ?? 'Try again.');
    } finally {
      setExportingAll(false);
    }
  };

  const confirmSignOut = () => {
    Alert.alert('Sign out?', 'You will need to sign in again to use the app.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign out', style: 'destructive', onPress: () => signOut() },
    ]);
  };

  const confirmDelete = () => {
    Alert.alert(
      'Delete your account?',
      "This permanently deletes your profile, all scanned receipts, and your sign-in. " +
        "If you sign up again, you'll start fresh — nothing carries over.\n\nThis cannot be undone.",
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete everything',
          style: 'destructive',
          onPress: doDelete,
        },
      ],
    );
  };

  const doDelete = async () => {
    if (working) return;
    try {
      setWorking(true);
      await deleteAccount();
    } catch (e) {
      const code = (e as { code?: string })?.code;
      if (code === 'auth/requires-recent-login') {
        Alert.alert(
          'Please sign in again',
          'For security, deleting an account requires a recent sign-in. Sign out and sign back in, then try again.',
          [{ text: 'OK', onPress: () => signOut() }],
        );
        return;
      }
      Alert.alert('Could not delete account', humanizeAuthError(e));
    } finally {
      setWorking(false);
    }
  };

  const editProfile = () => {
    router.push('/profile-setup' as never);
  };

  const toggleBiometric = async () => {
    try {
      await setBiometricEnabled(!biometricEnabled);
    } catch (e) {
      Alert.alert('Could not update', humanizeAuthError(e));
    }
  };

  const providerLabel =
    provider === 'password'
      ? 'Email & password'
      : provider === 'phone'
        ? 'Phone number'
        : provider === 'google.com'
          ? 'Google'
          : 'Other';

  const identity =
    user?.email ?? user?.phoneNumber ?? user?.displayName ?? 'Signed in';

  // Initials shown on the navy avatar circle when the user hasn't set a
  // profile photo — e.g. "John Doe" -> "JD". Falls back to a generic
  // person glyph if there's no name to derive initials from.
  const initials = profile
    ? `${profile.firstName?.trim()?.[0] ?? ''}${profile.lastName?.trim()?.[0] ?? ''}`.toUpperCase()
    : '';

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.screenTitle}>Settings</Text>

        <Section title="Profile">
          {profile ? (
            <>
              <View style={styles.profileHeader}>
                {profile.photoUri ? (
                  <Image source={{ uri: profile.photoUri }} style={styles.avatar} />
                ) : (
                  <View style={[styles.avatar, styles.avatarPlaceholder]}>
                    {initials ? (
                      <Text style={styles.avatarInitials}>{initials}</Text>
                    ) : (
                      <Ionicons name="person-outline" size={22} color="#FFFFFF" />
                    )}
                  </View>
                )}
                <View style={{ flex: 1, marginLeft: theme.spacing.md }}>
                  <Text style={styles.profileName} numberOfLines={1}>
                    {profile.firstName} {profile.lastName}
                  </Text>
                  <Text style={styles.profileMeta} numberOfLines={1}>
                    {identity}
                  </Text>
                </View>
              </View>
              <Pressable onPress={editProfile} style={styles.linkRow}>
                <Text style={styles.linkText}>Edit profile</Text>
                <Ionicons name="chevron-forward" size={16} color={theme.colors.accent} />
              </Pressable>
            </>
          ) : (
            <Pressable onPress={editProfile} style={styles.linkRow}>
              <Text style={styles.linkText}>Add profile details</Text>
              <Ionicons name="chevron-forward" size={16} color={theme.colors.accent} />
            </Pressable>
          )}
        </Section>

        {/*
          No CURRENCY section here: there's no multi-currency support
          anywhere in this codebase (no currency field on Receipt/
          Profile, no conversion helper in lib/). Rather than invent a
          USD/EUR/GBP/INR picker with no exchange-rate logic behind it,
          this section from the mockup is intentionally omitted — see
          the settings.tsx restyle notes for detail.
        */}

        <Section title="Categories & budgets">
          {ALL_CATEGORIES.map((cat: Category) => (
            <View key={cat} style={styles.budgetRow}>
              <View
                style={[styles.categoryDot, { backgroundColor: theme.colors.category[cat] }]}
              />
              <Text style={styles.categoryName} numberOfLines={1}>
                {cat}
              </Text>
              <View style={styles.budgetInputBox}>
                <Text style={styles.budgetCurrencyPrefix}>$</Text>
                <TextInput
                  value={categoryBudgets[cat] ?? ''}
                  onChangeText={(v) => updateCategoryBudget(cat, v)}
                  placeholder="0"
                  placeholderTextColor={theme.colors.textMuted}
                  keyboardType="numeric"
                  style={styles.budgetInput}
                />
              </View>
            </View>
          ))}
          <View style={styles.alertRow}>
            <View>
              <Text style={styles.alertLabel}>Budget alerts</Text>
              <Text style={styles.alertCaption}>Notify near limit</Text>
            </View>
            <Switch
              value={budgetAlertsEnabled}
              onValueChange={toggleBudgetAlerts}
              trackColor={{ false: theme.colors.border, true: theme.colors.primary }}
              thumbColor="#FFFFFF"
              style={styles.budgetAlertsSwitch}
            />
          </View>
        </Section>

        <View style={{ marginBottom: theme.spacing.sm }}>
          <Button
            label={exportingAll ? 'Exporting…' : 'Export all data'}
            onPress={exportAllData}
            variant="secondary"
            loading={exportingAll}
          />
        </View>

        <Pressable onPress={confirmSignOut} style={styles.signOutTextBtn} hitSlop={4}>
          <Text style={styles.signOutTextLabel}>Sign out</Text>
        </Pressable>

        <Section title="Account">
          <Row label="Signed in with" value={providerLabel} />
          <Row label="Identity" value={identity} />
        </Section>

        <Section title="Security">
          <Pressable onPress={toggleBiometric} style={styles.linkRow}>
            <Text style={styles.linkText}>
              Biometric unlock: {biometricEnabled ? 'On' : 'Off'}
            </Text>
            <Ionicons
              name={biometricEnabled ? 'toggle' : 'toggle-outline'}
              size={28}
              color={biometricEnabled ? theme.colors.primary : theme.colors.textMuted}
            />
          </Pressable>
        </Section>

        <Section title="Receipt parsing (Gemini)">
          <Text style={styles.keyHelp}>
            By default, the app uses a shared Gemini free-tier quota for
            AI receipt parsing. If you scan a lot of receipts and hit "AI
            quota reached", paste your own Gemini key below — it's free
            and gives you 1500 receipts/day on your own quota.
          </Text>
          <View style={styles.keyBlock}>
            <Text style={styles.keyLabel}>Your Gemini API key (optional)</Text>
            <View style={styles.keyRow}>
              <TextInput
                value={geminiKey}
                onChangeText={setGeminiKeyState}
                placeholder="AIza..."
                placeholderTextColor={theme.colors.textMuted}
                autoCapitalize="none"
                autoCorrect={false}
                secureTextEntry={!geminiVisible}
                style={styles.keyInput}
              />
              <Pressable
                onPress={() => setGeminiVisible((v) => !v)}
                hitSlop={14}
                accessibilityRole="button"
                accessibilityLabel={geminiVisible ? 'Hide key' : 'Show key'}
              >
                <Ionicons
                  name={geminiVisible ? 'eye-off-outline' : 'eye-outline'}
                  size={20}
                  color={theme.colors.textSecondary}
                  style={{ marginLeft: 8 }}
                />
              </Pressable>
            </View>
            <View style={styles.keyButtons}>
              <Pressable
                onPress={saveGeminiKey}
                disabled={savingGemini}
                style={[styles.keyButton, savingGemini && { opacity: 0.5 }]}
              >
                <Text style={styles.keyButtonText}>
                  {savingGemini ? 'Saving…' : 'Save key'}
                </Text>
              </Pressable>
              <Pressable
                onPress={testGeminiKey}
                disabled={testingGemini}
                style={[styles.keyButton, styles.keyButtonGhost, testingGemini && { opacity: 0.5 }]}
              >
                <Text style={[styles.keyButtonText, styles.keyButtonGhostText]}>
                  {testingGemini ? 'Testing…' : 'Test connection'}
                </Text>
              </Pressable>
            </View>
            <Text style={styles.keyHelp}>
              Free at aistudio.google.com → Get API key. Stored encrypted
              on this device only; never bundled into the app.
            </Text>
          </View>
        </Section>

        <Section title="AI categorization">
          <Pressable onPress={toggleAi} style={styles.linkRow}>
            <Text style={styles.linkText}>
              Use Anthropic for unknown items: {aiEnabled ? 'On' : 'Off'}
            </Text>
            <Ionicons
              name={aiEnabled ? 'toggle' : 'toggle-outline'}
              size={28}
              color={aiEnabled ? theme.colors.primary : theme.colors.textMuted}
            />
          </Pressable>
          <View style={styles.keyBlock}>
            <Text style={styles.keyLabel}>Anthropic API key</Text>
            <View style={styles.keyRow}>
              <TextInput
                value={apiKey}
                onChangeText={setApiKeyState}
                placeholder="sk-ant-..."
                placeholderTextColor={theme.colors.textMuted}
                autoCapitalize="none"
                autoCorrect={false}
                secureTextEntry={!keyVisible}
                style={styles.keyInput}
              />
              <Pressable
                onPress={() => setKeyVisible((v) => !v)}
                hitSlop={14}
                accessibilityRole="button"
                accessibilityLabel={keyVisible ? 'Hide key' : 'Show key'}
              >
                <Ionicons
                  name={keyVisible ? 'eye-off-outline' : 'eye-outline'}
                  size={20}
                  color={theme.colors.textSecondary}
                  style={{ marginLeft: 8 }}
                />
              </Pressable>
            </View>
            <View style={styles.keyButtons}>
              <Pressable
                onPress={saveKey}
                disabled={savingKey}
                style={[styles.keyButton, savingKey && { opacity: 0.5 }]}
              >
                <Text style={styles.keyButtonText}>
                  {savingKey ? 'Saving…' : 'Save key'}
                </Text>
              </Pressable>
              <Pressable
                onPress={testKey}
                disabled={testingKey}
                style={[styles.keyButton, styles.keyButtonGhost, testingKey && { opacity: 0.5 }]}
              >
                <Text style={[styles.keyButtonText, styles.keyButtonGhostText]}>
                  {testingKey ? 'Testing…' : 'Test connection'}
                </Text>
              </Pressable>
            </View>
            <Text style={styles.keyHelp}>
              Stored encrypted on this device only — never bundled into the
              app, never sent anywhere except api.anthropic.com. Get a key at
              console.anthropic.com → Settings → API Keys.
            </Text>
          </View>
        </Section>

        <Section title="Family">
          <FamilyPanel />
        </Section>

        <Section title="Cloud sync (debug)">
          <CloudSyncDiagnosticsPanel />
        </Section>

        <View style={styles.dangerZone}>
          <Pressable
            onPress={confirmDelete}
            style={[styles.deleteBtn, working && { opacity: 0.5 }]}
            disabled={working}
            hitSlop={4}
          >
            <Ionicons name="trash-outline" size={18} color={theme.colors.error} />
            <Text style={styles.deleteText}>
              {working ? 'Deleting…' : 'Delete account & data'}
            </Text>
          </Pressable>
          <Text style={styles.deleteHelp}>
            Permanently removes your sign-in, profile, and all receipts on this device.
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

/**
 * Family / household management. Shows everyone currently a member of
 * the user's active household, lets the user invite a new member by
 * email, and offers a "Leave household" action that puts them back in
 * a solo household.
 *
 * Invites are written to the top-level `invites/{lowercased-email}`
 * Firestore collection. The invitee's app checks for a pending invite
 * on every sign-in (see lib/AuthContext.tsx) and surfaces an accept
 * modal. We deliberately don't send an email — that would require
 * Firebase Dynamic Links (deprecated) or a Cloud Functions setup. The
 * inviter is expected to tell the invitee to install the app & sign
 * in with the email that received the invite.
 */
function FamilyPanel() {
  const theme = useTheme();
  const styles = useSettingsStyles();
  const { user } = useAuth();
  const [members, setMembers] = useState<HouseholdMember[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [inviting, setInviting] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [showInviteInput, setShowInviteInput] = useState(false);
  const [leaving, setLeaving] = useState(false);

  const refresh = useCallback(async () => {
    if (!user?.uid) return;
    const hid = getCurrentHouseholdId();
    if (!hid) {
      setMembers(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    const list = await getHouseholdMembers({ householdId: hid, currentUid: user.uid });
    setMembers(list);
    setLoading(false);
  }, [user?.uid]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const handleInvite = async () => {
    if (!user?.uid) return;
    const hid = getCurrentHouseholdId();
    if (!hid) {
      Alert.alert('No active household', 'Cloud sync isn\'t fully set up yet — try again in a moment.');
      return;
    }
    const trimmed = inviteEmail.trim();
    if (!trimmed || !trimmed.includes('@')) {
      Alert.alert('Invalid email', 'Please enter a valid email address.');
      return;
    }
    if (trimmed.toLowerCase() === user.email?.toLowerCase()) {
      Alert.alert('Already you', 'You\'re already a member of this household.');
      return;
    }
    setInviting(true);
    // Write the Firestore invite doc first — it's the source of
    // truth for the accept flow even if the email send hits a snag
    // (e.g. quota, recipient typo). The email is just a notification.
    const docRes = await inviteUserToHousehold({
      email: trimmed,
      householdId: hid,
      invitedByUid: user.uid,
      invitedByEmail: user.email ?? null,
      invitedByName: user.displayName ?? null,
    });
    if (!docRes.ok) {
      setInviting(false);
      Alert.alert('Invite failed', docRes.reason);
      return;
    }
    // Now ask Firebase to send the magic-link email. Failures here
    // are warnings, not blockers — the invite doc is already in
    // place and the recipient can still join by signing in manually
    // if they ever install the app.
    const emailRes = await sendInviteEmailLink(trimmed, {
      name: user.displayName ?? null,
      email: user.email ?? null,
    });
    setInviting(false);
    setInviteEmail('');
    setShowInviteInput(false);
    if (emailRes.ok) {
      // Stash the email locally so IF the inviter happens to be on
      // the device that receives the tap-through link, we can skip
      // the "enter your email" prompt.
      await rememberPendingInviteEmail(trimmed);
      Alert.alert(
        'Invite sent',
        `${trimmed} will receive an email with a one-tap link to install the app and accept the invite. The link expires in 24 hours.`,
      );
    } else {
      Alert.alert(
        'Email send failed',
        `The invite was recorded but the email couldn't be sent (${emailRes.reason}). Ask ${trimmed} to install BalanceSheet and sign in with that email — they'll still see the invite on first launch.`,
      );
    }
    refresh();
  };

  const handleLeave = () => {
    if (!user?.uid) return;
    const hid = getCurrentHouseholdId();
    if (!hid) return;
    const otherCount = (members ?? []).filter((m) => !m.isYou).length;
    const msg =
      otherCount > 0
        ? `Other members will still see all receipts in this household. You'll move to a brand-new solo household — any receipts you saved while sharing stay with the family.`
        : `You're the only member. The household will be left in place (you can rejoin later if you keep the household id), but a new solo household will be created for you.`;
    Alert.alert('Leave household?', msg, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Leave',
        style: 'destructive',
        onPress: async () => {
          setLeaving(true);
          const res = await leaveCurrentHousehold({
            uid: user.uid,
            currentHouseholdId: hid,
            email: user.email ?? null,
            displayName: user.displayName ?? null,
          });
          setLeaving(false);
          if (!res.ok) {
            Alert.alert('Leave failed', res.reason);
            return;
          }
          setCurrentHouseholdId(res.newSoloHouseholdId);
          refresh();
          Alert.alert('Left household', 'You now have your own solo household. Force-close + reopen for receipts to refresh.');
        },
      },
    ]);
  };

  if (loading) {
    return (
      <Text
        style={{
          color: theme.colors.textMuted,
          fontSize: theme.font.sm,
          fontFamily: theme.fonts.body.regular,
        }}
      >
        Loading household…
      </Text>
    );
  }
  if (!members) {
    return (
      <Text
        style={{
          color: theme.colors.textMuted,
          fontSize: theme.font.sm,
          fontFamily: theme.fonts.body.regular,
        }}
      >
        Cloud sync isn't ready yet — check back in a moment, or look at the debug panel below.
      </Text>
    );
  }
  return (
    <View style={{ gap: 8 }}>
      {members.map((m) => {
        // For the signed-in user, prefer the live Firebase Auth name/
        // email (always current) over whatever's stored on the
        // Firestore user doc (refreshed on bootstrap, but could be
        // stale or null for older accounts).
        const livePrimary = m.isYou
          ? user?.displayName ?? m.displayName ?? null
          : m.displayName ?? null;
        const liveEmail = m.isYou
          ? user?.email ?? m.email ?? null
          : m.email ?? null;
        const headline =
          livePrimary && livePrimary.trim()
            ? livePrimary
            : liveEmail && liveEmail.trim()
              ? liveEmail
              : 'Family member';
        const subtitle =
          liveEmail && liveEmail !== headline ? liveEmail : null;
        return (
          <View
            key={m.uid}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 10,
              paddingVertical: 6,
            }}
          >
            <Ionicons
              name={m.isYou ? 'person-circle' : 'person-circle-outline'}
              size={28}
              color={m.isYou ? theme.colors.primary : theme.colors.textSecondary}
            />
            <View style={{ flex: 1 }}>
              <Text
                style={{
                  color: theme.colors.textPrimary,
                  fontSize: theme.font.md,
                  fontFamily: theme.fonts.display.bold,
                }}
                numberOfLines={1}
              >
                {headline}
                {m.isYou ? '  (you)' : ''}
              </Text>
              {subtitle ? (
                <Text
                  style={{
                    color: theme.colors.textMuted,
                    fontSize: theme.font.xs,
                    fontFamily: theme.fonts.body.regular,
                  }}
                  numberOfLines={1}
                >
                  {subtitle}
                </Text>
              ) : null}
            </View>
            {m.role === 'owner' ? (
              <Text
                style={{
                  color: theme.colors.primary,
                  fontSize: theme.font.xs,
                  fontFamily: theme.fonts.display.bold,
                }}
              >
                Owner
              </Text>
            ) : null}
          </View>
        );
      })}

      {showInviteInput ? (
        <View style={{ gap: 8, marginTop: 4 }}>
          <TextInput
            value={inviteEmail}
            onChangeText={setInviteEmail}
            placeholder="family@example.com"
            placeholderTextColor={theme.colors.textMuted}
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            style={styles.keyInput}
          />
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Pressable
              onPress={() => {
                setShowInviteInput(false);
                setInviteEmail('');
              }}
              style={[styles.linkRow, { flex: 1 }]}
            >
              <Text style={styles.linkText}>Cancel</Text>
            </Pressable>
            <Pressable
              onPress={handleInvite}
              disabled={inviting}
              style={[
                styles.linkRow,
                {
                  flex: 1,
                  backgroundColor: theme.colors.primary,
                  opacity: inviting ? 0.5 : 1,
                  justifyContent: 'center',
                },
              ]}
            >
              <Text style={[styles.linkText, { color: '#fff' }]}>
                {inviting ? 'Sending…' : 'Send invite'}
              </Text>
            </Pressable>
          </View>
        </View>
      ) : (
        <Pressable
          onPress={() => setShowInviteInput(true)}
          style={styles.linkRow}
        >
          <Text style={styles.linkText}>+ Invite family member</Text>
          <Ionicons name="chevron-forward" size={16} color={theme.colors.accent} />
        </Pressable>
      )}

      {members.length > 1 || members.some((m) => !m.isYou) ? (
        <Pressable
          onPress={handleLeave}
          disabled={leaving}
          style={[styles.linkRow, { opacity: leaving ? 0.5 : 1 }]}
        >
          <Text style={[styles.linkText, { color: theme.colors.error }]}>
            {leaving ? 'Leaving…' : 'Leave household'}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

/**
 * Live read-out of Phase-2 cloud sync state. Renders the module-load,
 * household-bootstrap, last-receipt-sync, and last-migration status so
 * we can tell from a screenshot whether the native module is linked,
 * whether the bootstrap reached Firestore, and what (if anything)
 * went wrong. Subscribes to the same in-memory diagnostics buffer
 * cloudSync.ts writes to, so the panel updates as events fire — no
 * need to refresh manually.
 */
function CloudSyncDiagnosticsPanel() {
  const theme = useTheme();
  const styles = useSettingsStyles();
  const [diag, setDiag] = useState(getCloudSyncDiagnostics());

  useEffect(() => {
    const refresh = () => setDiag(getCloudSyncDiagnostics());
    const unsub = subscribeCloudSyncDiagnostics(refresh);
    // Pull a fresh snapshot once on mount so the panel reflects the
    // current state if the user opens Settings AFTER bootstrap has
    // already happened.
    refresh();
    return unsub;
  }, []);

  const fmt = (ts: string | undefined) => {
    if (!ts) return '—';
    try {
      return new Date(ts).toLocaleTimeString();
    } catch {
      return ts;
    }
  };

  return (
    <View style={{ gap: 6 }}>
      <Row
        label="Firestore module"
        value={diag.moduleAvailable ? 'linked' : 'NOT LINKED (need new APK)'}
      />
      <Row
        label="Storage module"
        value={diag.storageAvailable ? 'linked' : 'not enabled (optional)'}
      />
      <Row label="Household id" value={diag.householdId ?? 'not set'} />
      <Row
        label="Last bootstrap"
        value={
          diag.lastBootstrap
            ? `${diag.lastBootstrap.ok ? 'OK' : 'FAIL'} · ${fmt(diag.lastBootstrap.at)}${
                diag.lastBootstrap.message ? ` · ${diag.lastBootstrap.message}` : ''
              }`
            : 'never ran'
        }
      />
      <Row
        label="Last receipt sync"
        value={
          diag.lastReceiptSync
            ? `${diag.lastReceiptSync.ok ? 'OK' : 'FAIL'} · ${fmt(diag.lastReceiptSync.at)}${
                diag.lastReceiptSync.message ? ` · ${diag.lastReceiptSync.message}` : ''
              }`
            : 'never ran'
        }
      />
      <Row
        label="Last migration"
        value={
          diag.lastMigration
            ? `${diag.lastMigration.migrated} migrated, ${diag.lastMigration.failed} failed · ${fmt(diag.lastMigration.at)}`
            : 'never ran'
        }
      />
      <Text
        style={{
          color: theme.colors.textMuted,
          fontSize: theme.font.xs,
          fontFamily: theme.fonts.body.regular,
          marginTop: 6,
          fontStyle: 'italic',
        }}
      >
        Debug-only. Will be removed once cloud sync is stable.
      </Text>
    </View>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  const styles = useSettingsStyles();
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <View style={styles.card}>{children}</View>
    </View>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  const styles = useSettingsStyles();
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

