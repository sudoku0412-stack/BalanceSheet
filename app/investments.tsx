import React, { useCallback, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useFocusEffect } from 'expo-router';
import { v4 as uuidv4 } from 'uuid';
import { format } from 'date-fns';
import { ModalHeader } from '../components/ui/ModalHeader';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { EmptyState } from '../components/ui/EmptyState';
import { useStyles, useTheme } from '../constants/theme';
import { sanitizeAmountInput, parseAmountInput } from '../lib/amountValidation';
import { convertToUsd, CURRENCY_SYMBOLS, CurrencyCode, formatCurrency } from '../lib/currency';
import { addInvestmentSnapshot, getAllInvestmentAccounts, saveInvestmentAccount } from '../lib/database';
import { notifySuccess } from '../lib/haptics';
import { useEntitlements } from '../lib/EntitlementsContext';
import { useT } from '../lib/I18nContext';
import {
  INVESTMENT_KINDS,
  INVESTMENT_KIND_ICONS,
  INVESTMENT_KIND_KEYS,
  accountGain,
  gainLabel,
  snapshotOf,
  summarizeInvestments,
} from '../lib/investments';
import { getCurrency } from '../lib/secureStorage';
import type { InvestmentAccount, InvestmentKind } from '../types';

export default function InvestmentsScreen() {
  const t = useT();
  const theme = useTheme();
  const { isPremium, loading } = useEntitlements();
  const styles = useStyles((th) => ({
    root: { flex: 1, backgroundColor: th.colors.background },
    content: { padding: th.spacing.md, gap: th.spacing.sm, paddingBottom: 48 },
    fieldLabel: {
      color: th.colors.textSecondary,
      fontSize: th.font.xs,
      fontWeight: '800' as const,
      fontFamily: th.fonts.display.bold,
      textTransform: 'uppercase' as const,
      letterSpacing: 0.8,
    },
    hint: { color: th.colors.textMuted, fontSize: th.font.xs, fontFamily: th.fonts.body.regular },
    input: {
      color: th.colors.textPrimary,
      fontSize: th.font.md,
      fontFamily: th.fonts.body.regular,
      backgroundColor: th.colors.surfaceHigh,
      borderRadius: th.radius.lg,
      paddingHorizontal: 12,
      paddingVertical: 10,
      borderWidth: 1,
      borderColor: th.colors.border,
    },
    amountInput: { fontFamily: th.fonts.mono.medium },
    summaryRow: { flexDirection: 'row' as const, justifyContent: 'space-between' as const },
    summaryBlock: { flex: 1, gap: 2 },
    summaryValue: { color: th.colors.textPrimary, fontFamily: th.fonts.mono.medium, fontSize: th.font.lg },
    summaryLabel: { color: th.colors.textMuted, fontFamily: th.fonts.body.regular, fontSize: th.font.xs },
    kindRow: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: 8 },
    kindChip: {
      flexDirection: 'row' as const,
      alignItems: 'center' as const,
      gap: 4,
      borderWidth: 1,
      borderColor: th.colors.border,
      borderRadius: th.radius.full,
      paddingHorizontal: 12,
      paddingVertical: 6,
    },
    kindChipActive: { backgroundColor: th.colors.accent, borderColor: th.colors.accent },
    kindChipText: { color: th.colors.textPrimary, fontSize: th.font.sm, fontFamily: th.fonts.display.bold },
    kindChipTextActive: { color: '#fff' },
    accountRow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 12 },
    accountIcon: { fontSize: 22 },
    accountName: { color: th.colors.textPrimary, fontFamily: th.fonts.display.bold, fontSize: th.font.md },
    accountMeta: { color: th.colors.textMuted, fontFamily: th.fonts.body.regular, fontSize: th.font.xs },
    accountValue: { color: th.colors.textPrimary, fontFamily: th.fonts.mono.medium, fontSize: th.font.md },
  }));

  const [currency, setCurrency] = useState<CurrencyCode>('USD');
  const [accounts, setAccounts] = useState<InvestmentAccount[]>([]);
  const [name, setName] = useState('');
  const [kind, setKind] = useState<InvestmentKind>('stocks');
  const [value, setValue] = useState('');
  const [contributed, setContributed] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const [list, code] = await Promise.all([
      getAllInvestmentAccounts().catch(() => [] as InvestmentAccount[]),
      getCurrency(),
    ]);
    setAccounts(list);
    setCurrency((code as CurrencyCode | null) ?? 'USD');
  }, []);

  useFocusEffect(
    useCallback(() => {
      if (!loading && !isPremium) {
        router.replace('/paywall' as never);
        return;
      }
      load();
    }, [load, isPremium, loading]),
  );

  const handleCreate = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      Alert.alert(t('nameRequired'), t('invNameThis'));
      return;
    }
    const parsedValue = value.trim() ? parseAmountInput(value) : 0;
    const parsedContributed = contributed.trim() ? parseAmountInput(contributed) : parsedValue;
    if (parsedValue == null || parsedValue < 0 || parsedContributed == null || parsedContributed < 0) {
      Alert.alert(t('invalidAmount'), t('invValueInvalid'));
      return;
    }
    setSaving(true);
    try {
      const now = new Date().toISOString();
      const account: InvestmentAccount = {
        id: uuidv4(),
        name: trimmed,
        kind,
        valueUsd: convertToUsd(parsedValue, currency),
        contributedUsd: convertToUsd(parsedContributed, currency),
        createdAt: now,
        updatedAt: now,
      };
      await saveInvestmentAccount(account);
      await addInvestmentSnapshot(snapshotOf(account, uuidv4(), format(new Date(), 'yyyy-MM-dd'), now));
      setName('');
      setValue('');
      setContributed('');
      notifySuccess();
      await load();
    } catch (e) {
      Alert.alert(t('couldNotSave'), (e as Error)?.message ?? t('tryAgain'));
    } finally {
      setSaving(false);
    }
  };

  const summary = summarizeInvestments(accounts);
  const gainColor = (gain: number) =>
    gain > 0 ? theme.colors.success : gain < 0 ? theme.colors.error : theme.colors.textMuted;

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <ModalHeader title={t('investmentsTitle')} iconLeading="📈" onBack={() => router.back()} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          {accounts.length > 0 && (
            <View testID="investments-summary">
            <Card style={{ gap: theme.spacing.sm }}>
              <View style={styles.summaryRow}>
                <View style={styles.summaryBlock}>
                  <Text style={styles.summaryValue}>{formatCurrency(summary.valueUsd, currency)}</Text>
                  <Text style={styles.summaryLabel}>{t('invTotalValue')}</Text>
                </View>
                <View style={styles.summaryBlock}>
                  <Text style={styles.summaryValue}>{formatCurrency(summary.contributedUsd, currency)}</Text>
                  <Text style={styles.summaryLabel}>{t('invContributed')}</Text>
                </View>
              </View>
              <Text style={[styles.summaryValue, { color: gainColor(summary.gainUsd) }]} testID="investments-gain">
                {gainLabel(summary.gainUsd, summary.gainPct, currency, t)}
              </Text>
              <Text style={styles.summaryLabel}>{t('invGain')}</Text>
            </Card>
            </View>
          )}

          <Card style={{ gap: theme.spacing.sm }}>
            <Text style={styles.fieldLabel}>{t('invNewAccount')}</Text>
            <Text style={styles.hint}>{t('invIntro')}</Text>
            <TextInput
              style={styles.input}
              value={name}
              onChangeText={setName}
              placeholder={t('invAccountNamePlaceholder')}
              placeholderTextColor={theme.colors.textMuted}
              testID="inv-name"
            />
            <View style={styles.kindRow}>
              {INVESTMENT_KINDS.map((k) => {
                const active = k === kind;
                return (
                  <TouchableOpacity
                    key={k}
                    testID={`inv-kind-${k}`}
                    onPress={() => setKind(k)}
                    style={[styles.kindChip, active && styles.kindChipActive]}
                  >
                    <Text>{INVESTMENT_KIND_ICONS[k]}</Text>
                    <Text style={[styles.kindChipText, active && styles.kindChipTextActive]}>
                      {t(INVESTMENT_KIND_KEYS[k])}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            <TextInput
              style={[styles.input, styles.amountInput]}
              value={value}
              onChangeText={(v) => setValue(sanitizeAmountInput(v))}
              placeholder={`${t('invCurrentValue')} (${CURRENCY_SYMBOLS[currency]})`}
              placeholderTextColor={theme.colors.textMuted}
              keyboardType="decimal-pad"
              testID="inv-value"
            />
            <TextInput
              style={[styles.input, styles.amountInput]}
              value={contributed}
              onChangeText={(v) => setContributed(sanitizeAmountInput(v))}
              placeholder={`${t('invContributedSoFar')} (${CURRENCY_SYMBOLS[currency]})`}
              placeholderTextColor={theme.colors.textMuted}
              keyboardType="decimal-pad"
              testID="inv-contributed"
            />
            <Button label={t('invAddAccount')} onPress={handleCreate} loading={saving} />
          </Card>

          {accounts.length === 0 ? (
            <EmptyState icon="trending-up-outline" title={t('invNoneYet')} description={t('invNoneYetBody')} />
          ) : (
            accounts.map((a) => {
              const g = accountGain(a);
              return (
                <TouchableOpacity
                  key={a.id}
                  testID={`inv-account-${a.id}`}
                  activeOpacity={0.7}
                  onPress={() => router.push(`/investment/${a.id}` as never)}
                >
                  <Card style={styles.accountRow}>
                    <Text style={styles.accountIcon}>{INVESTMENT_KIND_ICONS[a.kind] ?? '💼'}</Text>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.accountName}>{a.name}</Text>
                      <Text style={[styles.accountMeta, { color: gainColor(g.gainUsd) }]}>
                        {gainLabel(g.gainUsd, g.gainPct, currency, t)}
                      </Text>
                    </View>
                    <Text style={styles.accountValue}>{formatCurrency(a.valueUsd, currency)}</Text>
                  </Card>
                </TouchableOpacity>
              );
            })
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
