import React, { useEffect, useState } from 'react';
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as FileSystem from 'expo-file-system';
import { useStyles, useTheme } from '../constants/theme';
import { Button } from '../components/ui/Button';
import { ALL_CATEGORIES } from '../constants/categories';
import { useAuth } from '../lib/AuthContext';
import {
  getBudgetAlertsEnabled,
  getCategoryBudgets,
  getCurrency,
  setBudgetAlertsEnabled as persistBudgetAlertsEnabled,
  setCategoryBudget,
  setCurrency as persistCurrency,
} from '../lib/secureStorage';
import { getAllReceipts } from '../lib/database';
import { receiptsToCsv } from '../lib/reports';
import {
  CURRENCIES,
  CURRENCY_SYMBOLS,
  convertFromUsd,
  convertToUsd,
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
      borderColor: theme.colors.primary,
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
  }));
}

export default function SettingsScreen() {
  const theme = useTheme();
  const styles = useSettingsStyles();
  const { user, profile, signOut } = useAuth();

  // Per-category budget amounts (canonical USD) and the "notify near
  // limit" toggle are persisted via lib/secureStorage
  // (getCategoryBudgets/setCategoryBudget, getBudgetAlertsEnabled/
  // setBudgetAlertsEnabled) — the same store the dashboard reads from.
  const [categoryBudgetsUsd, setCategoryBudgetsUsd] = useState<Record<string, number>>({});
  const [budgetInputs, setBudgetInputs] = useState<Record<string, string>>({});
  const [budgetAlertsEnabled, setBudgetAlertsEnabledState] = useState(true);
  const [exportingAll, setExportingAll] = useState(false);
  const [currency, setCurrencyState] = useState<CurrencyCode>('USD');

  useEffect(() => {
    let mounted = true;
    (async () => {
      const [budgets, alertsEnabled, storedCurrency] = await Promise.all([
        getCategoryBudgets(),
        getBudgetAlertsEnabled(),
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
    })();
    return () => {
      mounted = false;
    };
  }, []);

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

  const updateCategoryBudget = (cat: string, value: string) => {
    setBudgetInputs((prev) => ({ ...prev, [cat]: value }));
    const parsed = parseFloat(value);
    if (!Number.isNaN(parsed) && parsed >= 0) {
      const amountUsd = convertToUsd(parsed, currency);
      setCategoryBudgetsUsd((prev) => ({ ...prev, [cat]: amountUsd }));
      setCategoryBudget(cat, amountUsd);
    }
  };

  const toggleBudgetAlerts = (enabled: boolean) => {
    setBudgetAlertsEnabledState(enabled);
    persistBudgetAlertsEnabled(enabled);
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

  // Initials shown on the navy avatar circle — e.g. "John Doe" -> "JD".
  const initials = profile
    ? `${profile.firstName?.trim()?.[0] ?? ''}${profile.lastName?.trim()?.[0] ?? ''}`.toUpperCase()
    : '';

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
                {profile ? `${profile.firstName} ${profile.lastName}` : 'Signed in'}
              </Text>
              <Text style={styles.profileMeta} numberOfLines={1}>
                {user?.email ?? ''}
              </Text>
            </View>
          </View>
        </Section>

        <Section title="Currency">
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
          {ALL_CATEGORIES.map((cat: Category) => (
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
          <View style={styles.alertRow}>
            <Text style={styles.alertLabel}>Budget alerts</Text>
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
