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
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { v4 as uuidv4 } from 'uuid';
import { format } from 'date-fns';
import { ModalHeader } from '../../components/ui/ModalHeader';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { useStyles, useTheme } from '../../constants/theme';
import { sanitizeAmountInput, parseAmountInput } from '../../lib/amountValidation';
import { convertToUsd, CurrencyCode, CURRENCY_SYMBOLS, formatCurrency } from '../../lib/currency';
import { formatShortDate } from '../../lib/dateLocale';
import {
  addInvestmentSnapshot,
  deleteInvestmentAccount,
  getInvestmentAccountById,
  getInvestmentSnapshots,
  saveInvestmentAccount,
} from '../../lib/database';
import { notifySuccess } from '../../lib/haptics';
import { useEntitlements } from '../../lib/EntitlementsContext';
import { useLanguage, useT } from '../../lib/I18nContext';
import {
  INVESTMENT_KIND_ICONS,
  accountGain,
  applyContribution,
  applyValueUpdate,
  gainLabel,
  snapshotBars,
  snapshotOf,
} from '../../lib/investments';
import { getCurrency } from '../../lib/secureStorage';
import { parseYmdLocal } from '../../lib/parser';
import type { InvestmentAccount, InvestmentSnapshot } from '../../types';

export default function InvestmentDetailScreen() {
  const t = useT();
  const { language } = useLanguage();
  const theme = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
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
      fontFamily: th.fonts.mono.medium,
      backgroundColor: th.colors.surfaceHigh,
      borderRadius: th.radius.lg,
      paddingHorizontal: 12,
      paddingVertical: 10,
      borderWidth: 1,
      borderColor: th.colors.border,
    },
    bigValue: { color: th.colors.textPrimary, fontFamily: th.fonts.mono.medium, fontSize: 30 },
    meta: { color: th.colors.textMuted, fontFamily: th.fonts.body.regular, fontSize: th.font.xs },
    bars: { flexDirection: 'row' as const, alignItems: 'flex-end' as const, gap: 4, height: 64, marginTop: 8 },
    bar: { flex: 1, borderRadius: 4, backgroundColor: th.colors.accent, minHeight: 2 },
    historyRow: {
      flexDirection: 'row' as const,
      justifyContent: 'space-between' as const,
      paddingVertical: 6,
    },
    historyText: { color: th.colors.textPrimary, fontFamily: th.fonts.body.regular, fontSize: th.font.sm },
    danger: { color: th.colors.error, fontFamily: th.fonts.body.medium, fontSize: th.font.sm, textAlign: 'center' as const },
  }));

  const [currency, setCurrency] = useState<CurrencyCode>('USD');
  const [account, setAccount] = useState<InvestmentAccount | null>(null);
  const [snapshots, setSnapshots] = useState<InvestmentSnapshot[]>([]);
  const [missing, setMissing] = useState(false);
  const [newValue, setNewValue] = useState('');
  const [contribution, setContribution] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    const [acct, snaps, code] = await Promise.all([
      getInvestmentAccountById(id),
      getInvestmentSnapshots(id).catch(() => [] as InvestmentSnapshot[]),
      getCurrency(),
    ]);
    setCurrency((code as CurrencyCode | null) ?? 'USD');
    setAccount(acct);
    setSnapshots(snaps);
    setMissing(!acct);
  }, [id]);

  useFocusEffect(
    useCallback(() => {
      if (!loading && !isPremium) {
        router.replace('/paywall' as never);
        return;
      }
      load();
    }, [load, isPremium, loading]),
  );

  const persist = async (next: InvestmentAccount) => {
    setBusy(true);
    try {
      const now = new Date().toISOString();
      await saveInvestmentAccount(next);
      await addInvestmentSnapshot(snapshotOf(next, uuidv4(), format(new Date(), 'yyyy-MM-dd'), now));
      notifySuccess();
      await load();
    } catch (e) {
      Alert.alert(t('couldNotSave'), (e as Error)?.message ?? t('tryAgain'));
    } finally {
      setBusy(false);
    }
  };

  const saveValue = async () => {
    if (!account) return;
    const parsed = parseAmountInput(newValue);
    if (parsed == null || parsed < 0) {
      Alert.alert(t('invalidAmount'), t('invValueInvalid'));
      return;
    }
    await persist(applyValueUpdate(account, convertToUsd(parsed, currency), new Date().toISOString()));
    setNewValue('');
  };

  const addContribution = async (direction: 1 | -1) => {
    if (!account) return;
    const parsed = parseAmountInput(contribution);
    if (parsed == null || parsed <= 0) {
      Alert.alert(t('invalidAmount'), t('invValueInvalid'));
      return;
    }
    await persist(
      applyContribution(account, direction * convertToUsd(parsed, currency), new Date().toISOString()),
    );
    setContribution('');
  };

  const confirmDelete = () => {
    if (!account) return;
    Alert.alert(t('invDeleteTitle'), t('invDeleteBody'), [
      { text: t('cancel'), style: 'cancel' },
      {
        text: t('delete'),
        style: 'destructive',
        onPress: async () => {
          await deleteInvestmentAccount(account.id);
          router.back();
        },
      },
    ]);
  };

  const dateLabel = (ymd: string) => {
    const d = parseYmdLocal(ymd);
    return d ? formatShortDate(d, language) : ymd;
  };

  if (missing) {
    return (
      <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
        <ModalHeader title={t('invNotFound')} onBack={() => router.back()} />
      </SafeAreaView>
    );
  }
  if (!account) {
    return <SafeAreaView style={styles.root} edges={['top', 'bottom']} />;
  }

  const g = accountGain(account);
  const gainColor =
    g.gainUsd > 0 ? theme.colors.success : g.gainUsd < 0 ? theme.colors.error : theme.colors.textMuted;
  const bars = snapshotBars(snapshots);

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <ModalHeader title={account.name} iconLeading={INVESTMENT_KIND_ICONS[account.kind]} onBack={() => router.back()} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Card style={{ gap: 4 }}>
            <Text style={styles.bigValue} testID="inv-detail-value">
              {formatCurrency(account.valueUsd, currency)}
            </Text>
            <Text style={[styles.meta, { color: gainColor }]} testID="inv-detail-gain">
              {gainLabel(g.gainUsd, g.gainPct, currency, t)}
            </Text>
            <Text style={styles.meta}>
              {t('invContributed')}: {formatCurrency(account.contributedUsd, currency)}
            </Text>
            {bars.length > 1 && (
              <View style={styles.bars} testID="inv-bars">
                {bars.map((b) => (
                  <View key={b.id} style={[styles.bar, { height: `${Math.max(b.ratio, 0.03) * 100}%` }]} />
                ))}
              </View>
            )}
          </Card>

          <Card style={{ gap: theme.spacing.sm }}>
            <Text style={styles.fieldLabel}>{t('invUpdateValue')}</Text>
            <TextInput
              style={styles.input}
              value={newValue}
              onChangeText={(v) => setNewValue(sanitizeAmountInput(v))}
              placeholder={`${t('invNewValue')} (${CURRENCY_SYMBOLS[currency]})`}
              placeholderTextColor={theme.colors.textMuted}
              keyboardType="decimal-pad"
              testID="inv-new-value"
            />
            <Button label={t('invSaveValue')} onPress={saveValue} loading={busy} />
          </Card>

          <Card style={{ gap: theme.spacing.sm }}>
            <Text style={styles.fieldLabel}>{t('invAddContribution')}</Text>
            <Text style={styles.hint}>{t('invContributionHint')}</Text>
            <TextInput
              style={styles.input}
              value={contribution}
              onChangeText={(v) => setContribution(sanitizeAmountInput(v))}
              placeholder={`${t('invContributionAmount')} (${CURRENCY_SYMBOLS[currency]})`}
              placeholderTextColor={theme.colors.textMuted}
              keyboardType="decimal-pad"
              testID="inv-contribution"
            />
            <View style={{ flexDirection: 'row', gap: theme.spacing.sm }}>
              <View style={{ flex: 1 }}>
                <Button label={t('invDeposit')} onPress={() => addContribution(1)} loading={busy} />
              </View>
              <View style={{ flex: 1 }}>
                <Button label={t('invWithdraw')} onPress={() => addContribution(-1)} loading={busy} />
              </View>
            </View>
          </Card>

          <Card style={{ gap: 2 }}>
            <Text style={styles.fieldLabel}>{t('invHistory')}</Text>
            {snapshots.length === 0 ? (
              <Text style={styles.hint}>{t('invNoHistory')}</Text>
            ) : (
              snapshots.map((s) => (
                <View key={s.id} style={styles.historyRow}>
                  <Text style={styles.historyText}>{dateLabel(s.date)}</Text>
                  <Text style={styles.historyText}>{formatCurrency(s.valueUsd, currency)}</Text>
                </View>
              ))
            )}
          </Card>

          <TouchableOpacity onPress={confirmDelete} testID="inv-delete" style={{ padding: 12 }}>
            <Text style={styles.danger}>{t('delete')}</Text>
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
