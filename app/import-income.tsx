import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { v4 as uuidv4 } from 'uuid';
import { ModalHeader } from '../components/ui/ModalHeader';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { useStyles, useTheme } from '../constants/theme';
import { incomeCategoryLabel } from '../constants/incomeCategories';
import { creditsOnly, incomeFingerprint, parseBankCsv, type BankCsvRow } from '../lib/bankCsv';
import { useAuth } from '../lib/AuthContext';
import { convertToUsd, CURRENCY_SYMBOLS, CurrencyCode } from '../lib/currency';
import { getAllIncomes, saveIncome } from '../lib/database';
import { notifySuccess, tapLight } from '../lib/haptics';
import { getCurrency } from '../lib/secureStorage';
import { Income } from '../types';

export default function ImportIncomeScreen() {
  const theme = useTheme();
  const { user } = useAuth();
  const styles = useStyles((t) => ({
    root: { flex: 1, backgroundColor: t.colors.background },
    content: { padding: t.spacing.md, gap: t.spacing.sm, paddingBottom: 48 },
    fieldLabel: {
      color: t.colors.textSecondary,
      fontSize: t.font.xs,
      fontWeight: '800' as const,
      fontFamily: t.fonts.display.bold,
      textTransform: 'uppercase' as const,
      letterSpacing: 0.8,
    },
    hint: {
      color: t.colors.textMuted,
      fontSize: t.font.xs,
      fontFamily: t.fonts.body.regular,
    },
    input: {
      color: t.colors.textPrimary,
      fontSize: t.font.sm,
      fontFamily: t.fonts.mono.regular,
      backgroundColor: t.colors.surfaceHigh,
      borderRadius: t.radius.lg,
      paddingHorizontal: 12,
      paddingVertical: 10,
      borderWidth: 1,
      borderColor: t.colors.border,
      minHeight: 140,
      textAlignVertical: 'top' as const,
    },
    row: {
      flexDirection: 'row' as const,
      alignItems: 'center' as const,
      justifyContent: 'space-between' as const,
      gap: 10,
      paddingVertical: 8,
      borderBottomWidth: 1,
      borderBottomColor: t.colors.border,
    },
    rowMain: { flex: 1, gap: 2 },
    rowTitle: {
      color: t.colors.textPrimary,
      fontFamily: t.fonts.body.medium,
      fontSize: t.font.sm,
    },
    rowMeta: {
      color: t.colors.textMuted,
      fontFamily: t.fonts.body.regular,
      fontSize: t.font.xs,
    },
    rowAmount: {
      fontFamily: t.fonts.mono.medium,
      fontSize: t.font.sm,
    },
    toggleRow: {
      flexDirection: 'row' as const,
      alignItems: 'center' as const,
      justifyContent: 'space-between' as const,
      gap: 12,
    },
  }));

  const [csvText, setCsvText] = useState('');
  const [creditsOnlyToggle, setCreditsOnlyToggle] = useState(true);
  const [currency, setCurrency] = useState<CurrencyCode>('USD');
  const [existingFingerprints, setExistingFingerprints] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    getCurrency().then((c) => setCurrency((c as CurrencyCode | null) ?? 'USD'));
    getAllIncomes()
      .then((rows) => {
        setExistingFingerprints(
          new Set(rows.map((r) => incomeFingerprint(r.date, r.amountUsd, r.sourceName))),
        );
      })
      .catch(() => {});
  }, []);

  const parsed = useMemo(() => parseBankCsv(csvText), [csvText]);
  const visible = useMemo(
    () => (creditsOnlyToggle ? creditsOnly(parsed.rows) : parsed.rows),
    [creditsOnlyToggle, parsed.rows],
  );

  const applyParsedSelection = useCallback(() => {
    const next = new Set<string>();
    for (const row of creditsOnlyToggle ? creditsOnly(parsed.rows) : parsed.rows) {
      const already = existingFingerprints.has(
        incomeFingerprint(row.date, convertToUsd(row.amount, currency), row.description),
      );
      if (row.kind === 'credit' && !already) next.add(row.fingerprint);
    }
    setSelected(next);
  }, [creditsOnlyToggle, existingFingerprints, parsed.rows]);

  useEffect(() => {
    applyParsedSelection();
  }, [applyParsedSelection]);

  const toggleRow = (fp: string) => {
    tapLight();
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(fp)) next.delete(fp);
      else next.add(fp);
      return next;
    });
  };

  const handleImport = async () => {
    if (!user?.uid) {
      Alert.alert('Sign in required', 'Sign in to import income.');
      return;
    }
    const picks = visible.filter((r) => selected.has(r.fingerprint) && r.kind === 'credit');
    if (picks.length === 0) {
      Alert.alert('Nothing selected', 'Select at least one deposit to import as income.');
      return;
    }
    setSaving(true);
    try {
      const now = new Date().toISOString();
      for (const row of picks) {
        const amountUsd = convertToUsd(row.amount, currency);
        const income: Income = {
          id: uuidv4(),
          sourceName: row.description,
          date: row.date,
          amountUsd,
          category: row.category,
          earnedBy: user.uid,
          notes: 'Imported from bank CSV',
          originalCurrency: currency,
          createdBy: user.uid,
          createdAt: now,
          updatedAt: now,
        };
        await saveIncome(income);
      }
      notifySuccess();
      Alert.alert('Imported', `${picks.length} income ${picks.length === 1 ? 'entry' : 'entries'} saved.`, [
        { text: 'OK', onPress: () => router.back() },
      ]);
    } catch (e) {
      Alert.alert('Import failed', (e as Error)?.message ?? 'Try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <ModalHeader title="Import bank CSV" iconLeading="📥" />
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Card style={{ gap: theme.spacing.sm }}>
            <Text style={styles.fieldLabel}>Paste statement CSV</Text>
            <Text style={styles.hint}>
              Copy from your bank export (Date, Description, Amount — or Debit/Credit
              columns). Amounts are in your profile currency ({CURRENCY_SYMBOLS[currency]}
              {currency}). Debits stay out of income unless you uncheck the filter and
              still pick a deposit.
            </Text>
            <TextInput
              style={styles.input}
              value={csvText}
              onChangeText={setCsvText}
              placeholder={'Date,Description,Amount\n2026-03-01,Acme payroll,3200.00'}
              placeholderTextColor={theme.colors.textMuted}
              multiline
              autoCorrect={false}
              autoCapitalize="none"
              testID="bank-csv-input"
            />
          </Card>

          {csvText.trim() ? (
            <Card style={{ gap: theme.spacing.sm }}>
              <View style={styles.toggleRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.fieldLabel}>Deposits only</Text>
                  <Text style={styles.hint}>
                    {parsed.rows.length} row{parsed.rows.length === 1 ? '' : 's'} parsed
                    {parsed.skipped ? ` · ${parsed.skipped} skipped` : ''}
                  </Text>
                </View>
                <Switch
                  value={creditsOnlyToggle}
                  onValueChange={setCreditsOnlyToggle}
                  trackColor={{ false: theme.colors.border, true: theme.colors.primary }}
                  thumbColor="#FFFFFF"
                />
              </View>
              {visible.length === 0 ? (
                <Text style={styles.hint}>No matching rows. Check headers and amounts.</Text>
              ) : (
                visible.map((row) => (
                  <CsvCandidateRow
                    key={row.fingerprint}
                    row={row}
                    currency={currency}
                    selected={selected.has(row.fingerprint)}
                    alreadyImported={existingFingerprints.has(
                      incomeFingerprint(row.date, convertToUsd(row.amount, currency), row.description),
                    )}
                    onToggle={() => toggleRow(row.fingerprint)}
                    styles={styles}
                    themeColor={theme.colors}
                  />
                ))
              )}
              <Button
                label={
                  saving
                    ? 'Importing…'
                    : `Import ${[...selected].filter((fp) => visible.some((r) => r.fingerprint === fp && r.kind === 'credit')).length} deposits`
                }
                onPress={handleImport}
                loading={saving}
                size="lg"
              />
            </Card>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function CsvCandidateRow({
  row,
  currency,
  selected,
  alreadyImported,
  onToggle,
  styles,
  themeColor,
}: {
  row: BankCsvRow;
  currency: CurrencyCode;
  selected: boolean;
  alreadyImported: boolean;
  onToggle: () => void;
  styles: Record<string, object>;
  themeColor: { textPrimary: string; success: string; error: string; textMuted: string };
}) {
  const isCredit = row.kind === 'credit';
  return (
    <TouchableOpacity
      style={styles.row}
      onPress={onToggle}
      activeOpacity={0.7}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: selected }}
    >
      <View
        style={{
          width: 20,
          height: 20,
          borderRadius: 6,
          borderWidth: 1.5,
          borderColor: selected ? themeColor.success : themeColor.textMuted,
          backgroundColor: selected ? themeColor.success : 'transparent',
        }}
      />
      <View style={styles.rowMain}>
        <Text style={styles.rowTitle} numberOfLines={1}>
          {row.description}
        </Text>
        <Text style={styles.rowMeta}>
          {row.date} · {incomeCategoryLabel(row.category)}
          {alreadyImported ? ' · already logged' : ''}
          {!isCredit ? ' · withdrawal' : ''}
        </Text>
      </View>
      <Text
        style={[
          styles.rowAmount,
          { color: isCredit ? themeColor.success : themeColor.error },
        ]}
      >
        {isCredit ? '+' : '−'}
        {CURRENCY_SYMBOLS[currency]}
        {row.amount.toFixed(2)}
      </Text>
    </TouchableOpacity>
  );
}
