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
import { useEntitlements } from '../lib/EntitlementsContext';
import { v4 as uuidv4 } from 'uuid';
import { ModalHeader } from '../components/ui/ModalHeader';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { useStyles, useTheme } from '../constants/theme';
import { sanitizeAmountInput, parseAmountInput } from '../lib/amountValidation';
import { convertToUsd, CURRENCY_SYMBOLS, CurrencyCode, formatCurrency } from '../lib/currency';
import {
  deleteSavingsGoal,
  getAllSavingsGoals,
  saveSavingsGoal,
} from '../lib/database';
import { notifySuccess, tapLight } from '../lib/haptics';
import { getCurrency } from '../lib/secureStorage';
import { SavingsGoal } from '../types';

import { useT } from '../lib/I18nContext';
export default function SavingsGoalsScreen() {
  const t = useT();
  const theme = useTheme();
  const { isPremium, loading } = useEntitlements();
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
      fontSize: t.font.md,
      fontFamily: t.fonts.body.regular,
      backgroundColor: t.colors.surfaceHigh,
      borderRadius: t.radius.lg,
      paddingHorizontal: 12,
      paddingVertical: 10,
      borderWidth: 1,
      borderColor: t.colors.border,
    },
    amountInput: { fontFamily: t.fonts.mono.medium },
    goalName: {
      color: t.colors.textPrimary,
      fontFamily: t.fonts.display.bold,
      fontSize: t.font.md,
    },
    goalMeta: {
      color: t.colors.textMuted,
      fontFamily: t.fonts.body.regular,
      fontSize: t.font.xs,
    },
    track: {
      height: 8,
      borderRadius: 999,
      backgroundColor: t.colors.surfaceHigh,
      overflow: 'hidden' as const,
      marginTop: 8,
    },
    fill: { height: '100%' as const, borderRadius: 999, backgroundColor: t.colors.success },
    rowActions: { flexDirection: 'row' as const, gap: 12, marginTop: 8 },
    link: { color: t.colors.accent, fontFamily: t.fonts.body.medium, fontSize: t.font.sm },
    danger: { color: t.colors.error, fontFamily: t.fonts.body.medium, fontSize: t.font.sm },
  }));

  const [currency, setCurrency] = useState<CurrencyCode>('USD');
  const [goals, setGoals] = useState<SavingsGoal[]>([]);
  const [name, setName] = useState('');
  const [target, setTarget] = useState('');
  const [allocateDraft, setAllocateDraft] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const [list, code] = await Promise.all([
      getAllSavingsGoals().catch(() => []),
      getCurrency(),
    ]);
    setGoals(list);
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
    const parsed = parseAmountInput(target);
    if (!trimmed) {
      Alert.alert(t('nameRequired'), t('nameThisEnvelopeEG'));
      return;
    }
    if (parsed == null || parsed <= 0) {
      Alert.alert(t('targetRequired'), t('enterATargetAmountGreater'));
      return;
    }
    setSaving(true);
    try {
      const now = new Date().toISOString();
      await saveSavingsGoal({
        id: uuidv4(),
        name: trimmed,
        targetUsd: convertToUsd(parsed, currency),
        allocatedUsd: 0,
        createdAt: now,
        updatedAt: now,
      });
      setName('');
      setTarget('');
      notifySuccess();
      await load();
    } catch (e) {
      Alert.alert(t('couldNotSave'), (e as Error)?.message ?? t('tryAgain'));
    } finally {
      setSaving(false);
    }
  };

  const addToEnvelope = async (goal: SavingsGoal) => {
    const parsed = parseAmountInput(allocateDraft[goal.id] ?? '');
    if (parsed == null || parsed === 0) {
      Alert.alert(t('amountRequired'), t('enterHowMuchToAdd'));
      return;
    }
    tapLight();
    await saveSavingsGoal({
      ...goal,
      allocatedUsd: Math.max(0, goal.allocatedUsd + convertToUsd(parsed, currency)),
      updatedAt: new Date().toISOString(),
    });
    setAllocateDraft((prev) => ({ ...prev, [goal.id]: '' }));
    await load();
  };

  const confirmDelete = (goal: SavingsGoal) => {
    Alert.alert(t('deleteEnvelope'), goal.name, [
      { text: t('cancel'), style: 'cancel' },
      {
        text: t('delete'),
        style: 'destructive',
        onPress: async () => {
          await deleteSavingsGoal(goal.id);
          await load();
        },
      },
    ]);
  };

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <ModalHeader title={t('savingsGoals')} iconLeading="🎯" />
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Card style={{ gap: theme.spacing.sm }}>
            <Text style={styles.fieldLabel}>{t('newEnvelope')}</Text>
            <Text style={styles.hint}>
              {t('trackANamedGoalAllocated')}
            </Text>
            <TextInput
              style={styles.input}
              value={name}
              onChangeText={setName}
              placeholder={t('emergencyFund')}
              placeholderTextColor={theme.colors.textMuted}
              testID="goal-name"
            />
            <TextInput
              style={[styles.input, styles.amountInput]}
              value={target}
              onChangeText={(t) => setTarget(sanitizeAmountInput(t))}
              placeholder={t('targetWithSymbol', { symbol: CURRENCY_SYMBOLS[currency] })}
              placeholderTextColor={theme.colors.textMuted}
              keyboardType="decimal-pad"
              testID="goal-target"
            />
            <Button label={t('addGoal')} onPress={handleCreate} loading={saving} />
          </Card>

          {goals.map((goal) => {
            const ratio = goal.targetUsd > 0 ? Math.min(goal.allocatedUsd / goal.targetUsd, 1) : 0;
            return (
              <Card key={goal.id} style={{ gap: 4 }}>
                <Text style={styles.goalName}>{goal.name}</Text>
                <Text style={styles.goalMeta}>
                  {t('amountOfAmount', {
                    a: formatCurrency(goal.allocatedUsd, currency),
                    b: formatCurrency(goal.targetUsd, currency),
                  })}
                  {goal.targetUsd > 0
                    ? ` · ${Math.round((goal.allocatedUsd / goal.targetUsd) * 100)}%`
                    : ''}
                </Text>
                <View style={styles.track}>
                  <View style={[styles.fill, { width: `${ratio * 100}%` }]} />
                </View>
                <View style={styles.rowActions}>
                  <TextInput
                    style={[styles.input, styles.amountInput, { flex: 1 }]}
                    value={allocateDraft[goal.id] ?? ''}
                    onChangeText={(t) =>
                      setAllocateDraft((prev) => ({ ...prev, [goal.id]: sanitizeAmountInput(t) }))
                    }
                    placeholder={t('symbolAmount', { symbol: CURRENCY_SYMBOLS[currency] })}
                    placeholderTextColor={theme.colors.textMuted}
                    keyboardType="decimal-pad"
                  />
                  <TouchableOpacity onPress={() => addToEnvelope(goal)}>
                    <Text style={styles.link}>{t('add')}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => confirmDelete(goal)}>
                    <Text style={styles.danger}>{t('delete')}</Text>
                  </TouchableOpacity>
                </View>
              </Card>
            );
          })}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
