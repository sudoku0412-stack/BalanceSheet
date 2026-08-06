import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import * as FileSystem from 'expo-file-system';
import { useStyles, useTheme } from '../constants/theme';
import { Button } from '../components/ui/Button';
import { useToast } from '../components/ui/Toast';
import { ALL_CATEGORIES } from '../constants/categories';
import { useAuth } from '../lib/AuthContext';
import {
  getBudgetAlertsEnabled,
  getBudgetsSnapshot,
  getCategoryBudgets,
  getCurrency,
  setBudgetAlertsEnabled as persistBudgetAlertsEnabled,
  setCategoryBudget,
  setCurrency as persistCurrency,
} from '../lib/secureStorage';
import { getAllReceipts, getCurrentHouseholdId } from '../lib/database';
import { registerForPushNotificationsAsync, requestNotificationPermission } from '../lib/notifications';
import {
  getHouseholdMembers,
  inviteUserToHousehold,
  isCloudSyncAvailable,
  leaveHousehold,
  syncBudgetsToCloud,
  syncPushTokenToCloud,
  type HouseholdMember,
} from '../lib/cloudSync';
import { receiptsToCsv } from '../lib/reports';
import { RECURRING_BUDGET_KEY } from '../lib/recurring';
import { pickContactWithPhone, isContactPickerAvailable } from '../lib/contactPicker';
import { addByPhone } from '../lib/phoneInvite';
import {
  CURRENCIES,
  CURRENCY_SYMBOLS,
  convertFromUsd,
  convertToUsd,
  formatCurrency,
  type CurrencyCode,
} from '../lib/currency';
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
    profileHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: theme.spacing.md,
      paddingVertical: theme.spacing.md,
    },
    avatar: {
      width: 48,
      height: 48,
      borderRadius: theme.radius.full,
      backgroundColor: theme.colors.primary,
      alignItems: 'center',
      justifyContent: 'center',
      // Dark-navy fill blends into the dark-mode card; a light-toned
      // border in dark mode keeps the avatar readable as its own shape.
      borderWidth: theme.isDark ? 1 : 0,
      borderColor: theme.isDark ? theme.colors.borderLight : 'transparent',
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
    currencyRow: {
      flexDirection: 'row',
      gap: theme.spacing.sm,
      paddingHorizontal: theme.spacing.xs,
      flexWrap: 'wrap',
    },
    currencyPill: {
      borderWidth: 1,
      borderColor: theme.colors.border,
      borderRadius: theme.radius.full,
      paddingHorizontal: theme.spacing.md,
      paddingVertical: 8,
    },
    currencyPillActive: {
      backgroundColor: theme.colors.primary,
      // In dark mode, override the border so the pill's shape stays
      // visible against the dark-mode page instead of blending in.
      borderColor: theme.isDark ? theme.colors.borderLight : theme.colors.primary,
    },
    currencyPillText: {
      color: theme.colors.textPrimary,
      fontSize: theme.font.sm,
      fontFamily: theme.fonts.display.bold,
    },
    currencyPillTextActive: {
      color: '#FFFFFF',
    },
    currencyCaption: {
      color: theme.colors.textMuted,
      fontSize: theme.font.xs,
      fontFamily: theme.fonts.body.regular,
      marginTop: theme.spacing.sm,
      paddingHorizontal: theme.spacing.xs,
      lineHeight: 16,
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
    budgetAlertsSwitch: {
      // Native Switch has no width/height props — the design spec calls
      // for a 40x24px pill, close to the default ~51x31 control, so we
      // scale it down instead of reimplementing a custom pill toggle.
      transform: [{ scaleX: 0.8 }, { scaleY: 0.8 }],
    },
    memberRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: theme.spacing.md,
      paddingVertical: 12,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.colors.border,
      gap: theme.spacing.sm,
    },
    memberAvatar: {
      width: 36,
      height: 36,
      borderRadius: theme.radius.full,
      backgroundColor: theme.colors.primary,
      alignItems: 'center',
      justifyContent: 'center',
      // Dark-navy fill blends into the dark-mode row; a light-toned
      // border in dark mode keeps the avatar readable as its own shape.
      borderWidth: theme.isDark ? 1 : 0,
      borderColor: theme.isDark ? theme.colors.borderLight : 'transparent',
    },
    memberAvatarInitials: {
      color: '#FFFFFF',
      fontSize: theme.font.sm,
      fontFamily: theme.fonts.display.bold,
    },
    memberName: {
      flex: 1,
      color: theme.colors.textPrimary,
      fontSize: theme.font.md,
      fontFamily: theme.fonts.display.bold,
    },
    memberRoleBadge: {
      borderWidth: 1,
      borderColor: theme.colors.border,
      borderRadius: theme.radius.full,
      paddingHorizontal: 10,
      paddingVertical: 4,
    },
    memberRoleText: {
      color: theme.colors.textMuted,
      fontSize: theme.font.xs,
      fontFamily: theme.fonts.display.bold,
      textTransform: 'uppercase',
    },
    inviteRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: theme.spacing.md,
      paddingVertical: theme.spacing.md,
      gap: theme.spacing.sm,
    },
    inviteInput: {
      flex: 1,
      borderWidth: 1,
      borderColor: theme.colors.border,
      borderRadius: theme.radius.full,
      paddingHorizontal: theme.spacing.md,
      paddingVertical: 10,
      color: theme.colors.textPrimary,
      fontSize: theme.font.sm,
      fontFamily: theme.fonts.body.regular,
      backgroundColor: theme.colors.background,
    },
    inviteSendBtn: {
      backgroundColor: theme.colors.primary,
      borderRadius: theme.radius.full,
      paddingHorizontal: theme.spacing.md,
      paddingVertical: 10,
      alignItems: 'center',
      justifyContent: 'center',
      // Dark-navy fill blends into the dark-mode row; a light-toned
      // border in dark mode keeps the button readable as its own shape.
      borderWidth: theme.isDark ? 1 : 0,
      borderColor: theme.isDark ? theme.colors.borderLight : 'transparent',
    },
    inviteSendBtnDisabled: {
      opacity: 0.5,
    },
    inviteSendText: {
      color: '#FFFFFF',
      fontSize: theme.font.sm,
      fontFamily: theme.fonts.display.bold,
    },
    inviteHint: {
      color: theme.colors.textMuted,
      fontSize: theme.font.xs,
      fontFamily: theme.fonts.body.regular,
      marginTop: 6,
      marginBottom: 4,
    },
    cloudSyncWarning: {
      color: theme.colors.error,
      fontSize: theme.font.xs,
      fontFamily: theme.fonts.body.regular,
      marginBottom: theme.spacing.sm,
    },
    leaveHouseholdBtn: {
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: 12,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: theme.colors.border,
    },
    leaveHouseholdText: {
      color: theme.colors.textMuted,
      fontSize: theme.font.sm,
      fontFamily: theme.fonts.display.bold,
    },
  }));
}

export default function SettingsScreen() {
  const theme = useTheme();
  const styles = useSettingsStyles();
  const router = useRouter();
  const { user, profile, signOut, refreshProfile, setActiveHousehold } = useAuth();
  const toast = useToast();

  // Per-category budget amounts (canonical USD) and the "notify near
  // limit" toggle are persisted via lib/secureStorage
  // (getCategoryBudgets/setCategoryBudget, getBudgetAlertsEnabled/
  // setBudgetAlertsEnabled) — the same store the dashboard reads from.
  const [categoryBudgetsUsd, setCategoryBudgetsUsd] = useState<Record<string, number>>({});
  const [budgetInputs, setBudgetInputs] = useState<Record<string, string>>({});
  const [budgetAlertsEnabled, setBudgetAlertsEnabledState] = useState(true);
  const [exportingAll, setExportingAll] = useState(false);
  const [currency, setCurrencyState] = useState<CurrencyCode>('USD');

  // Household membership (Phase 3 split feature). Loaded from Firestore
  // via getHouseholdMembers — null while loading, [] if cloud sync isn't
  // available (or the household has no doc yet).
  const [members, setMembers] = useState<HouseholdMember[] | null>(null);
  const [inviteEmail, setInviteEmail] = useState('');
  const [invitingSending, setInviteSending] = useState(false);
  const [addingByPhone, setAddingByPhone] = useState(false);
  const [leavingHousehold, setLeavingHousehold] = useState(false);
  // Local-only echo of the last invite this device successfully sent —
  // NOT a query of pending invites (Firestore only tracks one pending
  // invite per invitee email, not per-sender). Exists purely so "Send"
  // gives visible confirmation beyond a toast that can be missed,
  // since sending an invite never changes `members` (the invitee only
  // joins once THEY sign in and accept).
  const [lastInvitedEmail, setLastInvitedEmail] = useState<string | null>(null);

  const loadMembers = React.useCallback(async () => {
    const householdId = getCurrentHouseholdId();
    if (!householdId || !user?.uid) {
      setMembers(null);
      return;
    }
    const result = await getHouseholdMembers({ householdId, currentUid: user.uid });
    setMembers(result);
  }, [user?.uid]);

  useEffect(() => {
    loadMembers();
  }, [loadMembers]);

  const sendInvite = async () => {
    const householdId = getCurrentHouseholdId();
    if (!householdId || !user?.uid) return;
    const email = inviteEmail.trim();
    if (!email) return;
    setInviteSending(true);
    try {
      const res = await inviteUserToHousehold({
        email,
        householdId,
        invitedByUid: user.uid,
        invitedByEmail: user.email ?? null,
        invitedByName: profile ? `${profile.firstName} ${profile.lastName}`.trim() : null,
        budgets: await getBudgetsSnapshot(householdId),
      });
      if (res.ok) {
        toast.show({ kind: 'success', message: 'Invite sent' });
        setLastInvitedEmail(email);
        setInviteEmail('');
      } else {
        toast.show({ kind: 'error', message: res.reason || "Couldn't send invite" });
      }
    } catch (e) {
      toast.show({ kind: 'error', message: (e as Error)?.message ?? "Couldn't send invite" });
    } finally {
      setInviteSending(false);
    }
  };

  const addMemberByPhone = async () => {
    const householdId = getCurrentHouseholdId();
    if (!householdId || !user?.uid || addingByPhone) return;
    if (!isContactPickerAvailable()) {
      toast.show({
        kind: 'error',
        message: "This app needs an update before phone invites work — try again after updating.",
      });
      return;
    }
    setAddingByPhone(true);
    try {
      const contact = await pickContactWithPhone();
      if (!contact) return; // cancelled, or no usable phone number
      const result = await addByPhone({
        phoneE164: contact.phoneE164,
        householdId,
        householdName: null,
        invitedByUid: user.uid,
        invitedByName: profile ? `${profile.firstName} ${profile.lastName}`.trim() : null,
        budgets: await getBudgetsSnapshot(householdId),
      });
      if (!result.ok) {
        toast.show({ kind: 'error', message: result.reason || "Couldn't add by phone" });
      } else if (result.matched) {
        await loadMembers();
        toast.show({ kind: 'success', message: `${result.displayName || contact.name} added` });
      } else {
        // No existing account matched this number — hand off to the
        // OS's own share sheet so the user sends the invite text
        // themselves (iMessage/SMS/WhatsApp/etc), free, no Twilio.
        try {
          await Share.share({ message: result.inviteText });
        } catch {
          // User backed out of the share sheet — the invite doc is
          // already saved regardless, so it's not a failure.
        }
      }
    } catch (e) {
      toast.show({ kind: 'error', message: (e as Error)?.message ?? "Couldn't add by phone" });
    } finally {
      setAddingByPhone(false);
    }
  };

  const confirmLeaveHousehold = () => {
    Alert.alert('Leave household?', 'You will move to your own solo household. Other members keep the shared receipts.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Leave', style: 'destructive', onPress: () => doLeaveHousehold() },
    ]);
  };

  const doLeaveHousehold = async () => {
    const householdId = getCurrentHouseholdId();
    if (!householdId || !user?.uid || leavingHousehold) return;
    setLeavingHousehold(true);
    try {
      const res = await leaveHousehold({
        uid: user.uid,
        householdId,
        email: user.email ?? null,
        displayName: profile ? `${profile.firstName} ${profile.lastName}`.trim() : null,
      });
      if (res.ok) {
        await setActiveHousehold(res.nextActiveHouseholdId);
        toast.show({ kind: 'success', message: 'You left the household' });
        await loadMembers();
      } else {
        toast.show({ kind: 'error', message: res.reason || "Couldn't leave household" });
      }
    } catch (e) {
      toast.show({ kind: 'error', message: (e as Error)?.message ?? "Couldn't leave household" });
    } finally {
      setLeavingHousehold(false);
    }
  };

  const memberInitials = (m: HouseholdMember): string => {
    const label = m.displayName || m.email || '';
    const parts = label.trim().split(/\s+/).filter(Boolean);
    if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return '·';
  };

  // Re-runs on every focus (not just mount) so returning from the
  // Households switcher screen reloads THIS household's budgets —
  // Settings is a tab and doesn't remount on navigation.
  useFocusEffect(
    useCallback(() => {
      let mounted = true;
      (async () => {
        const householdId = getCurrentHouseholdId();
        if (!householdId) return;
        const [budgets, alertsEnabled, storedCurrency] = await Promise.all([
          getCategoryBudgets(householdId),
          getBudgetAlertsEnabled(householdId),
          getCurrency(),
        ]);
        if (!mounted) return;
        const nextCurrency: CurrencyCode =
          storedCurrency && (CURRENCIES as string[]).includes(storedCurrency)
            ? (storedCurrency as CurrencyCode)
            : 'USD';
        setCategoryBudgetsUsd(budgets);
        setBudgetInputs(
          Object.fromEntries(
            Object.entries(budgets).map(([cat, amountUsd]) => [
              cat,
              formatBudgetInput(convertFromUsd(amountUsd, nextCurrency), nextCurrency),
            ]),
          ),
        );
        setBudgetAlertsEnabledState(alertsEnabled);
        setCurrencyState(nextCurrency);
        await loadMembers();
      })();
      return () => {
        mounted = false;
      };
    }, [loadMembers]),
  );

  const selectCurrency = (code: CurrencyCode) => {
    if (code === currency) return;
    setCurrencyState(code);
    persistCurrency(code);
    // Re-render every budget input converted into the newly selected
    // currency — the canonical USD amount underneath doesn't change.
    setBudgetInputs(
      Object.fromEntries(
        Object.entries(categoryBudgetsUsd).map(([cat, amountUsd]) => [
          cat,
          formatBudgetInput(convertFromUsd(amountUsd, code), code),
        ]),
      ),
    );
  };

  // Mirrors the just-changed budgets onto the household doc so every
  // OTHER member — new or already in the household — converges to the
  // same amounts via subscribeToHouseholdBudgets (lib/AuthContext.tsx),
  // not just brand-new invitees getting a one-time copy at join time.
  const pushBudgetsToCloud = (byCategory: Record<string, number>, alertsEnabled: boolean) => {
    const householdId = getCurrentHouseholdId();
    if (!householdId) return;
    void syncBudgetsToCloud(householdId, { byCategory, alertsEnabled });
  };

  const updateCategoryBudget = (cat: string, value: string) => {
    setBudgetInputs((prev) => ({ ...prev, [cat]: value }));
    const parsed = parseFloat(value);
    const householdId = getCurrentHouseholdId();
    if (!Number.isNaN(parsed) && parsed >= 0 && householdId) {
      const amountUsd = convertToUsd(parsed, currency);
      const nextBudgets = { ...categoryBudgetsUsd, [cat]: amountUsd };
      setCategoryBudgetsUsd(nextBudgets);
      setCategoryBudget(householdId, cat, amountUsd);
      pushBudgetsToCloud(nextBudgets, budgetAlertsEnabled);
    }
  };

  const toggleBudgetAlerts = async (enabled: boolean) => {
    // The toggle itself just represents "I want alerts" and is always
    // persisted as chosen. Turning it ON additionally kicks off the OS
    // permission handshake — turning it OFF never prompts for anything.
    const householdId = getCurrentHouseholdId();
    setBudgetAlertsEnabledState(enabled);
    if (householdId) persistBudgetAlertsEnabled(householdId, enabled);
    pushBudgetsToCloud(categoryBudgetsUsd, enabled);
    if (enabled) {
      const granted = await requestNotificationPermission();
      if (!granted) {
        toast.show({
          kind: 'error',
          message:
            "Notifications are turned off for NestExpenseTracker — enable them in your device Settings to actually receive budget alerts.",
        });
        return;
      }
      // Register right away instead of waiting for the next sign-in —
      // other household members' devices push THIS token as soon as
      // their own activity (over-budget, a shared expense, settling
      // up) happens, so it shouldn't sit unset until next app launch.
      const token = await registerForPushNotificationsAsync();
      if (token && user?.uid) void syncPushTokenToCloud(user.uid, token);
    }
  };

  /**
   * Exports every receipt on this device/household as a single CSV —
   * reuses the same `getAllReceipts` + `receiptsToCsv` + share-sheet
   * pattern already proven out in Reports' date-range export
   * (app/reports.tsx), just without the date filter. Lazily requires
   * expo-sharing so this doesn't crash on a build where the native
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
      const csv = receiptsToCsv(receipts, currency);
      const filename = `NestExpenseTracker All Data - ${new Date().toISOString().slice(0, 10)}.csv`;
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

  // Initials shown on the navy avatar circle — e.g. "John Doe" -> "JD".
  const initials = profile
    ? `${profile.firstName?.trim()?.[0] ?? ''}${profile.lastName?.trim()?.[0] ?? ''}`.toUpperCase()
    : (user?.displayName ?? '')
        .trim()
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .map((w) => w[0])
        .join('')
        .toUpperCase();

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.screenTitle}>Settings</Text>

        <Section title="Profile">
          <View style={styles.profileHeader}>
            <View style={styles.avatar}>
              <Text style={styles.avatarInitials}>{initials || '·'}</Text>
            </View>
            <View style={{ flex: 1, marginLeft: theme.spacing.md }}>
              <Text style={styles.profileName} numberOfLines={1}>
                {profile
                  ? `${profile.firstName} ${profile.lastName}`.trim()
                  : user?.displayName || 'Signed in'}
              </Text>
              <Text style={styles.profileMeta} numberOfLines={1}>
                {user?.email ?? ''}
              </Text>
              {profile?.phone ? (
                <Text style={styles.profileMeta} numberOfLines={1}>
                  {profile.phone}
                </Text>
              ) : null}
            </View>
          </View>
          <View style={{ paddingHorizontal: theme.spacing.md, paddingBottom: theme.spacing.md }}>
            <Pressable
              onPress={() => router.push('/edit-profile')}
              style={styles.leaveHouseholdBtn}
              hitSlop={4}
            >
              <Text style={styles.leaveHouseholdText}>Edit profile</Text>
            </Pressable>
          </View>
        </Section>

        <Section title="Household">
          {!isCloudSyncAvailable() && (
            <Text style={styles.cloudSyncWarning}>
              Cloud sync isn't available on this install, so household members
              and split can't work right now. This app may need a fresh
              build/update — try updating the app, and if that doesn't help,
              let the developer know.
            </Text>
          )}
          {(members ?? [{ uid: user?.uid ?? 'you', email: user?.email ?? null, displayName: profile ? `${profile.firstName} ${profile.lastName}`.trim() : null, role: 'owner' as const, isYou: true }]).map(
            (m) => {
              const row = (
                <>
                  <View style={styles.memberAvatar}>
                    <Text style={styles.memberAvatarInitials}>{memberInitials(m)}</Text>
                  </View>
                  <Text style={styles.memberName} numberOfLines={1}>
                    {m.displayName || m.email || 'Household member'}
                  </Text>
                  <View style={styles.memberRoleBadge}>
                    <Text style={styles.memberRoleText}>
                      {m.isYou ? 'You' : m.role === 'owner' ? 'Owner' : 'Member'}
                    </Text>
                  </View>
                </>
              );
              return m.isYou ? (
                <View key={m.uid} style={styles.memberRow}>
                  {row}
                </View>
              ) : (
                <Pressable
                  key={m.uid}
                  style={styles.memberRow}
                  onPress={() => router.push(`/shared-expenses/${m.uid}`)}
                >
                  {row}
                </Pressable>
              );
            },
          )}

          <View style={styles.inviteRow}>
            <TextInput
              value={inviteEmail}
              onChangeText={setInviteEmail}
              placeholder="Invite by email"
              placeholderTextColor={theme.colors.textMuted}
              autoCapitalize="none"
              keyboardType="email-address"
              style={styles.inviteInput}
            />
            <Pressable
              onPress={sendInvite}
              disabled={invitingSending || !inviteEmail.trim()}
              style={[
                styles.inviteSendBtn,
                (invitingSending || !inviteEmail.trim()) && styles.inviteSendBtnDisabled,
              ]}
            >
              <Text style={styles.inviteSendText}>{invitingSending ? 'Sending…' : 'Send'}</Text>
            </Pressable>
          </View>
          {lastInvitedEmail && (
            <Text style={styles.inviteHint}>
              Invite sent to {lastInvitedEmail} — they'll show up here once
              they sign in with that email and accept.
            </Text>
          )}

          <Pressable
            onPress={addMemberByPhone}
            disabled={addingByPhone}
            style={{ paddingHorizontal: theme.spacing.md, paddingVertical: theme.spacing.sm }}
          >
            <Text
              style={{
                color: addingByPhone ? theme.colors.textMuted : theme.colors.accent,
                fontSize: theme.font.sm,
                fontFamily: theme.fonts.display.bold,
              }}
            >
              {addingByPhone ? 'Adding…' : 'Add by phone contact'}
            </Text>
          </Pressable>

          {members && members.length > 1 ? (
            <Pressable
              onPress={confirmLeaveHousehold}
              style={styles.leaveHouseholdBtn}
              disabled={leavingHousehold}
              hitSlop={4}
            >
              <Text style={styles.leaveHouseholdText}>
                {leavingHousehold ? 'Leaving…' : 'Leave household'}
              </Text>
            </Pressable>
          ) : null}
        </Section>

        <Section title="Profile Currency">
          <View style={{ paddingVertical: theme.spacing.sm }}>
            <View style={styles.currencyRow}>
              {CURRENCIES.map((code) => {
                const active = code === currency;
                return (
                  <Pressable
                    key={code}
                    onPress={() => selectCurrency(code)}
                    style={[styles.currencyPill, active && styles.currencyPillActive]}
                  >
                    <Text
                      style={[
                        styles.currencyPillText,
                        active && styles.currencyPillTextActive,
                      ]}
                    >
                      {code}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            <Text style={styles.currencyCaption}>
              Amounts are shown in {currency} at approximate exchange rates.
            </Text>
          </View>
        </Section>

        <Section title="Categories & budgets">
          {ALL_CATEGORIES.filter((cat) => cat !== RECURRING_BUDGET_KEY).map((cat: Category) => (
            <View key={cat} style={styles.budgetRow}>
              <View
                style={[styles.categoryDot, { backgroundColor: theme.colors.category[cat] }]}
              />
              <Text style={styles.categoryName} numberOfLines={1}>
                {cat}
              </Text>
              <View style={styles.budgetInputBox}>
                <Text style={styles.budgetCurrencyPrefix}>{CURRENCY_SYMBOLS[currency]}</Text>
                <TextInput
                  value={budgetInputs[cat] ?? ''}
                  onChangeText={(v) => updateCategoryBudget(cat, v)}
                  placeholder="0"
                  placeholderTextColor={theme.colors.textMuted}
                  keyboardType="numeric"
                  style={styles.budgetInput}
                />
              </View>
            </View>
          ))}
          {/* Not a receipt category — a separate axis covering ALL
              recurring expenses regardless of their own category, so a
              "how much am I auto-committed to every month" limit can be
              tracked apart from any one category's limit. */}
          <View style={styles.budgetRow}>
            <View style={[styles.categoryDot, { backgroundColor: theme.colors.accent }]} />
            <Text style={styles.categoryName} numberOfLines={1}>
              {RECURRING_BUDGET_KEY}
            </Text>
            <View style={styles.budgetInputBox}>
              <Text style={styles.budgetCurrencyPrefix}>{CURRENCY_SYMBOLS[currency]}</Text>
              <TextInput
                value={budgetInputs[RECURRING_BUDGET_KEY] ?? ''}
                onChangeText={(v) => updateCategoryBudget(RECURRING_BUDGET_KEY, v)}
                placeholder="0"
                placeholderTextColor={theme.colors.textMuted}
                keyboardType="numeric"
                style={styles.budgetInput}
              />
            </View>
          </View>
          <Pressable
            onPress={() => router.push('/recurring' as never)}
            style={styles.leaveHouseholdBtn}
            hitSlop={4}
          >
            <Text style={styles.leaveHouseholdText}>View recurring schedule</Text>
          </Pressable>
          <View style={styles.alertRow}>
            {/* Now the single on/off switch for every push notification
                this app sends — budget alerts, a new shared expense,
                and settle-up confirmations — not just budgets. Kept
                the original storage key (bs.budgets.alertsEnabled) to
                avoid a migration; only the label changed. */}
            <View style={{ flex: 1, marginRight: theme.spacing.sm }}>
              <Text style={styles.alertLabel}>Notifications</Text>
              <Text style={styles.inviteHint}>Budget alerts, shared expenses, settle-ups</Text>
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
      </ScrollView>
    </SafeAreaView>
  );
}

/** Formats a converted budget amount for display in the numeric input —
 * whole numbers for INR (no minor unit in everyday use), 2 decimals
 * otherwise. Only used to seed the field; the user's own typing is left
 * untouched by updateCategoryBudget. */
function formatBudgetInput(amount: number, currency: CurrencyCode): string {
  if (amount === 0) return '';
  const decimals = currency === 'INR' ? 0 : 2;
  return amount.toFixed(decimals);
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
