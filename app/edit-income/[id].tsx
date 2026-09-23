import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
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
import { router, useLocalSearchParams } from 'expo-router';
import { ModalHeader } from '../../components/ui/ModalHeader';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { DateField } from '../../components/ui/DateField';
import { useStyles, useTheme } from '../../constants/theme';
import {
  ALL_INCOME_CATEGORIES,
  INCOME_CATEGORY_ICONS,
  incomeCategoryLabel,
  sourceNamePlaceholder,
} from '../../constants/incomeCategories';
import { sanitizeAmountInput, parseAmountInput } from '../../lib/amountValidation';
import { useAuth } from '../../lib/AuthContext';
import { getHouseholdMembers, HouseholdMember } from '../../lib/cloudSync';
import {
  convertFromUsd,
  convertToUsd,
  CURRENCY_SYMBOLS,
  CurrencyCode,
} from '../../lib/currency';
import {
  deleteIncome,
  getCurrentHouseholdId,
  getIncomeById,
  saveIncome,
} from '../../lib/database';
import { notifySuccess, tapLight } from '../../lib/haptics';
import { getCurrency } from '../../lib/secureStorage';
import { Income, IncomeCategory } from '../../types';

function memberLabel(m: HouseholdMember): string {
  return m.displayName?.trim() || m.email?.trim() || 'Member';
}

function initialFor(label: string): string {
  const trimmed = label.trim();
  return trimmed ? trimmed.charAt(0).toUpperCase() : '?';
}

export default function EditIncomeScreen() {
  const theme = useTheme();
  const { user } = useAuth();
  const { id } = useLocalSearchParams<{ id: string }>();
  const styles = useStyles((t) => ({
    root: { flex: 1, backgroundColor: t.colors.background },
    centered: {
      flex: 1,
      justifyContent: 'center' as const,
      alignItems: 'center' as const,
    },
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
    notFoundText: {
      color: t.colors.textSecondary,
      fontSize: t.font.lg,
      marginBottom: t.spacing.md,
    },
    saveBtn: { marginTop: t.spacing.sm },
    deleteBtn: { marginTop: t.spacing.xs },
  }));

  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [createdAt, setCreatedAt] = useState<string>('');
  const [createdBy, setCreatedBy] = useState<string | undefined>();
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState('');
  const [category, setCategory] = useState<IncomeCategory>('Salary');
  const [sourceName, setSourceName] = useState('');
  const [notes, setNotes] = useState('');
  const [earnedBy, setEarnedBy] = useState<string | null>(null);
  const [members, setMembers] = useState<HouseholdMember[]>([]);
  const [currency, setCurrency] = useState<CurrencyCode>('USD');
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    if (!id) {
      setNotFound(true);
      setLoading(false);
      return;
    }
    try {
      const [income, currencyCode] = await Promise.all([
        getIncomeById(id),
        getCurrency(),
      ]);
      const profileCurrency = ((currencyCode as CurrencyCode | null) ?? 'USD') as CurrencyCode;
      if (!income) {
        setNotFound(true);
        setLoading(false);
        return;
      }
      const displayCurrency = income.originalCurrency ?? profileCurrency;
      setCurrency(displayCurrency);
      setAmount(convertFromUsd(income.amountUsd, displayCurrency).toFixed(2));
      setDate(income.date);
      setCategory(income.category);
      setSourceName(income.sourceName);
      setNotes(income.notes ?? '');
      setEarnedBy(income.earnedBy);
      setCreatedAt(income.createdAt);
      setCreatedBy(income.createdBy);
      setNotFound(false);

      if (user?.uid) {
        const hid = getCurrentHouseholdId();
        if (hid) {
          const list = await getHouseholdMembers({
            householdId: hid,
            currentUid: user.uid,
          });
          setMembers(list ?? []);
        }
      }
    } catch {
      setNotFound(true);
    } finally {
      setLoading(false);
    }
  }, [id, user?.uid]);

  useEffect(() => {
    load();
  }, [load]);

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
    if (!earnedBy || !user?.uid || !id) {
      Alert.alert('Whose income?', 'Pick who earned this income.');
      return;
    }

    setSaving(true);
    try {
      const now = new Date().toISOString();
      const amountUsd = convertToUsd(parsed, currency);
      const income: Income = {
        id,
        sourceName: trimmedSource,
        date,
        amountUsd,
        category,
        earnedBy,
        notes: notes.trim() || undefined,
        originalCurrency: currency,
        createdBy: createdBy ?? user.uid,
        createdAt: createdAt || now,
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

  const confirmDelete = () => {
    Alert.alert('Delete income', 'This action cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: performDelete,
      },
    ]);
  };

  const performDelete = async () => {
    if (!id || deleting) return;
    setDeleting(true);
    try {
      await deleteIncome(id);
      notifySuccess();
      router.back();
    } catch (e) {
      Alert.alert('Delete failed', (e as Error)?.message ?? 'Try again.');
    } finally {
      setDeleting(false);
    }
  };

  if (loading) {
    return (
      <SafeAreaView style={[styles.root, styles.centered]} edges={['top', 'bottom']}>
        <ActivityIndicator color={theme.colors.accent} />
      </SafeAreaView>
    );
  }

  if (notFound) {
    return (
      <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
        <ModalHeader title="Edit Income" />
        <View style={styles.centered}>
          <Text style={styles.notFoundText}>Income not found</Text>
          <Button label="Go back" onPress={() => router.back()} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <ModalHeader
        title="Edit Income"
        iconLeading="💰"
        rightActions={[
          {
            icon: 'trash-outline',
            onPress: confirmDelete,
            disabled: deleting,
            accessibilityLabel: 'Delete income',
          },
        ]}
      />
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
            <Text style={styles.currencyHint}>Saved in {currency}</Text>
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
          </Card>

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
            label="Save changes"
            onPress={handleSave}
            loading={saving}
            size="lg"
            style={styles.saveBtn}
          />
          <Button
            label="Delete"
            onPress={confirmDelete}
            loading={deleting}
            variant="danger"
            size="lg"
            style={styles.deleteBtn}
          />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
