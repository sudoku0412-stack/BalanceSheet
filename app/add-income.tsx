import React, { useCallback, useEffect, useState } from 'react';
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
import { router } from 'expo-router';
import { format } from 'date-fns';
import { v4 as uuidv4 } from 'uuid';
import { ModalHeader } from '../components/ui/ModalHeader';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { DateField } from '../components/ui/DateField';
import { useStyles, useTheme } from '../constants/theme';
import {
  ALL_INCOME_CATEGORIES,
  INCOME_CATEGORY_ICONS,
  incomeCategoryLabel,
  sourceNamePlaceholder,
} from '../constants/incomeCategories';
import { sanitizeAmountInput, parseAmountInput } from '../lib/amountValidation';
import { useAuth } from '../lib/AuthContext';
import { getHouseholdMembers, HouseholdMember } from '../lib/cloudSync';
import { convertToUsd, CURRENCY_SYMBOLS, CurrencyCode } from '../lib/currency';
import { getCurrentHouseholdId, getRecentIncomeSourceNames, saveIncome } from '../lib/database';
import { notifySuccess, tapLight } from '../lib/haptics';
import {
  advance as advanceRecurringDate,
  resolveRecurringFromForm,
} from '../lib/recurring';
import { getCurrency } from '../lib/secureStorage';
import { RecurringScheduleFields, RecurringFrequency } from '../components/RecurringScheduleFields';
import { Income, IncomeCategory } from '../types';

function memberLabel(m: HouseholdMember): string {
  return m.displayName?.trim() || m.email?.trim() || 'Member';
}

function initialFor(label: string): string {
  const trimmed = label.trim();
  return trimmed ? trimmed.charAt(0).toUpperCase() : '?';
}

export default function AddIncomeScreen() {
  const theme = useTheme();
  const { user } = useAuth();
  const styles = useStyles((t) => ({
    root: { flex: 1, backgroundColor: t.colors.background },
    content: {
      padding: t.spacing.md,
      gap: t.spacing.sm,
      paddingBottom: 40,
    },
    fieldCard: {
      gap: t.spacing.sm,
      borderRadius: t.radius.lg,
    },
    fieldLabel: {
      color: t.colors.textSecondary,
      fontSize: t.font.xs,
      fontWeight: '800' as const,
      fontFamily: t.fonts.display.bold,
      textTransform: 'uppercase' as const,
      letterSpacing: 0.8,
    },
    input: {
      color: t.colors.textPrimary,
      fontSize: t.font.md,
      fontFamily: t.fonts.body.regular,
      backgroundColor: t.colors.surfaceHigh,
      borderRadius: t.radius.lg,
      paddingHorizontal: 12,
      paddingVertical: 10,
      borderWidth: 1,
      borderColor: t.colors.border,
    },
    amountInput: {
      fontFamily: t.fonts.mono.medium,
      fontWeight: '500' as const,
    },
    inputMultiline: {
      minHeight: 72,
      paddingTop: 10,
      textAlignVertical: 'top' as const,
    },
    categoryChipsRow: {
      flexDirection: 'row' as const,
      flexWrap: 'wrap' as const,
      gap: 8,
      marginTop: t.spacing.xs,
    },
    categoryChip: {
      flexDirection: 'row' as const,
      alignItems: 'center' as const,
      gap: 4,
      paddingHorizontal: 12,
      paddingVertical: 7,
      borderRadius: t.radius.full,
      borderWidth: 1.5,
      borderColor: t.colors.success,
    },
    categoryChipText: {
      fontSize: t.font.sm,
      fontWeight: '700' as const,
      fontFamily: t.fonts.body.medium,
    },
    avatarRow: {
      flexDirection: 'row' as const,
      flexWrap: 'wrap' as const,
      gap: 12,
    },
    avatarWrap: {
      alignItems: 'center' as const,
      gap: 4,
    },
    avatarCircle: {
      width: 40,
      height: 40,
      borderRadius: 999,
      alignItems: 'center' as const,
      justifyContent: 'center' as const,
      backgroundColor: t.colors.surfaceHigh,
      borderWidth: 2,
      borderColor: 'transparent',
    },
    avatarInitial: {
      color: t.colors.textPrimary,
      fontWeight: '700' as const,
      fontSize: t.font.sm,
    },
    avatarLabel: {
      color: t.colors.textSecondary,
      fontSize: t.font.xs,
      maxWidth: 56,
      textAlign: 'center' as const,
    },
    currencyHint: {
      color: t.colors.textMuted,
      fontSize: t.font.xs,
      fontFamily: t.fonts.body.regular,
    },
    saveBtn: { marginTop: t.spacing.sm },
    suggestionRow: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: 8 },
    suggestionChip: {
      paddingHorizontal: 10,
      paddingVertical: 6,
      borderRadius: t.radius.full,
      backgroundColor: t.colors.surfaceHigh,
      borderWidth: 1,
      borderColor: t.colors.border,
    },
    suggestionText: {
      color: t.colors.textSecondary,
      fontSize: t.font.xs,
      fontFamily: t.fonts.body.medium,
    },
  }));

  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [category, setCategory] = useState<IncomeCategory>('Salary');
  const [sourceName, setSourceName] = useState('');
  const [notes, setNotes] = useState('');
  const [earnedBy, setEarnedBy] = useState<string | null>(user?.uid ?? null);
  const [members, setMembers] = useState<HouseholdMember[]>([]);
  const [currency, setCurrency] = useState<CurrencyCode>('USD');
  const [saving, setSaving] = useState(false);
  const [recentSources, setRecentSources] = useState<string[]>([]);
  const [recurringEnabled, setRecurringEnabled] = useState(false);
  const [recurringFrequency, setRecurringFrequency] = useState<RecurringFrequency>('monthly');
  const [recurringDuration, setRecurringDuration] = useState('');
  const [recurringNextDate, setRecurringNextDate] = useState('');
  const [recurringNextDateTouched, setRecurringNextDateTouched] = useState(false);

  useEffect(() => {
    if (user?.uid && !earnedBy) setEarnedBy(user.uid);
  }, [user?.uid, earnedBy]);

  const loadMembers = useCallback(async () => {
    const currencyCode = await getCurrency();
    setCurrency((currencyCode as CurrencyCode | null) ?? 'USD');
    if (!user?.uid) return;
    const sources = await getRecentIncomeSourceNames(8).catch(() => []);
    setRecentSources(sources);
    const hid = getCurrentHouseholdId();
    if (!hid) {
      setMembers([]);
      return;
    }
    const list = await getHouseholdMembers({ householdId: hid, currentUid: user.uid });
    setMembers(list ?? []);
  }, [user?.uid]);

  useEffect(() => {
    loadMembers();
  }, [loadMembers]);

  useEffect(() => {
    if (!recurringEnabled || recurringNextDateTouched) return;
    setRecurringNextDate(advanceRecurringDate(date, recurringFrequency));
  }, [recurringEnabled, recurringFrequency, recurringNextDateTouched, date]);

  const otherMembers = members.filter((m) => !m.isYou);

  const selectEarnedBy = (uid: string) => {
    tapLight();
    setEarnedBy(uid);
  };

  const handleSave = async () => {
    const parsed = parseAmountInput(amount);
    if (parsed == null || parsed <= 0) {
      Alert.alert('Amount required', 'Enter a valid amount greater than zero.');
      return;
    }
    const trimmedSource = sourceName.trim();
    if (!trimmedSource) {
      Alert.alert('Source required', 'Name where this income came from.');
      return;
    }
    if (!earnedBy || !user?.uid) {
      Alert.alert('Whose income?', 'Pick who earned this income.');
      return;
    }
    const recurringRes = resolveRecurringFromForm({
      enabled: recurringEnabled,
      frequency: recurringFrequency,
      nextDueDate: recurringNextDate,
      duration: recurringDuration,
      startDate: date,
    });
    if (!recurringRes.ok) {
      Alert.alert('Repeat schedule', recurringRes.message);
      return;
    }

    setSaving(true);
    try {
      const now = new Date().toISOString();
      const amountUsd = convertToUsd(parsed, currency);
      const income: Income = {
        id: uuidv4(),
        sourceName: trimmedSource,
        date,
        amountUsd,
        category,
        earnedBy,
        notes: notes.trim() || undefined,
        originalCurrency: currency,
        recurring: recurringRes.schedule,
        createdBy: user.uid,
        createdAt: now,
        updatedAt: now,
      };
      await saveIncome(income);
      notifySuccess();
      router.back();
    } catch (e) {
      Alert.alert('Save failed', (e as Error)?.message ?? 'Try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <ModalHeader title="Add Income" iconLeading="💰" />
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
        >
          <Card style={styles.fieldCard}>
            <Text style={styles.fieldLabel}>
              Amount ({CURRENCY_SYMBOLS[currency]})
            </Text>
            <TextInput
              style={[styles.input, styles.amountInput]}
              value={amount}
              onChangeText={(text) => setAmount(sanitizeAmountInput(text))}
              placeholder="0.00"
              placeholderTextColor={theme.colors.textMuted}
              keyboardType="decimal-pad"
            />
            <Text style={styles.currencyHint}>Saved in your profile currency ({currency})</Text>
          </Card>

          <Card style={styles.fieldCard}>
            <Text style={styles.fieldLabel}>Date</Text>
            <DateField value={date} onChange={setDate} placeholder="YYYY-MM-DD" />
          </Card>

          <Card style={styles.fieldCard}>
            <Text style={styles.fieldLabel}>Whose income</Text>
            <View style={styles.avatarRow}>
              {user?.uid ? (
                <TouchableOpacity
                  style={styles.avatarWrap}
                  onPress={() => selectEarnedBy(user.uid)}
                  activeOpacity={0.7}
                >
                  <View
                    style={[
                      styles.avatarCircle,
                      {
                        borderColor: earnedBy === user.uid ? theme.colors.accent : 'transparent',
                        opacity: earnedBy === user.uid ? 1 : 0.35,
                      },
                    ]}
                  >
                    <Text style={styles.avatarInitial}>Y</Text>
                  </View>
                  <Text style={styles.avatarLabel} numberOfLines={1}>
                    You
                  </Text>
                </TouchableOpacity>
              ) : null}
              {otherMembers.map((m) => {
                const label = memberLabel(m);
                const active = earnedBy === m.uid;
                return (
                  <TouchableOpacity
                    key={m.uid}
                    style={styles.avatarWrap}
                    onPress={() => selectEarnedBy(m.uid)}
                    activeOpacity={0.7}
                  >
                    <View
                      style={[
                        styles.avatarCircle,
                        {
                          borderColor: active ? theme.colors.accent : 'transparent',
                          opacity: active ? 1 : 0.35,
                        },
                      ]}
                    >
                      <Text style={styles.avatarInitial}>{initialFor(label)}</Text>
                    </View>
                    <Text style={styles.avatarLabel} numberOfLines={1}>
                      {label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </Card>

          <Card style={styles.fieldCard}>
            <Text style={styles.fieldLabel}>Type</Text>
            <View style={styles.categoryChipsRow}>
              {ALL_INCOME_CATEGORIES.map((cat) => {
                const active = category === cat;
                return (
                  <TouchableOpacity
                    key={cat}
                    onPress={() => {
                      tapLight();
                      setCategory(cat);
                    }}
                    activeOpacity={0.7}
                    style={[
                      styles.categoryChip,
                      {
                        backgroundColor: active ? theme.colors.success : 'transparent',
                      },
                    ]}
                  >
                    <Text style={{ fontSize: 14 }}>{INCOME_CATEGORY_ICONS[cat]}</Text>
                    <Text
                      style={[
                        styles.categoryChipText,
                        { color: active ? '#FFFFFF' : theme.colors.success },
                      ]}
                    >
                      {incomeCategoryLabel(cat)}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </Card>

          <Card style={styles.fieldCard}>
            <Text style={styles.fieldLabel}>Source</Text>
            <TextInput
              style={styles.input}
              value={sourceName}
              onChangeText={setSourceName}
              placeholder={sourceNamePlaceholder(category)}
              placeholderTextColor={theme.colors.textMuted}
              autoCorrect={false}
            />
            {recentSources.length > 0 ? (
              <View style={styles.suggestionRow}>
                {recentSources.map((name) => (
                  <TouchableOpacity
                    key={name}
                    style={styles.suggestionChip}
                    onPress={() => {
                      tapLight();
                      setSourceName(name);
                    }}
                    activeOpacity={0.7}
                  >
                    <Text style={styles.suggestionText}>{name}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            ) : null}
          </Card>

          <RecurringScheduleFields
            title="Repeat this income"
            enabled={recurringEnabled}
            onEnabledChange={setRecurringEnabled}
            frequency={recurringFrequency}
            onFrequencyChange={setRecurringFrequency}
            nextDueDate={recurringNextDate}
            onNextDueDateChange={(v) => {
              setRecurringNextDateTouched(true);
              setRecurringNextDate(v);
            }}
            duration={recurringDuration}
            onDurationChange={setRecurringDuration}
          />

          <Card style={styles.fieldCard}>
            <Text style={styles.fieldLabel}>Notes (optional)</Text>
            <TextInput
              style={[styles.input, styles.inputMultiline]}
              value={notes}
              onChangeText={setNotes}
              placeholder="Anything else…"
              placeholderTextColor={theme.colors.textMuted}
              multiline
            />
          </Card>

          <Button
            label="Save income"
            onPress={handleSave}
            loading={saving}
            size="lg"
            style={styles.saveBtn}
          />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
