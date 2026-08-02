import React, { useCallback, useState } from 'react';
import { ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { format } from 'date-fns';
import { ModalHeader } from '../components/ui/ModalHeader';
import { EmptyState } from '../components/ui/EmptyState';
import { useStyles, useTheme } from '../constants/theme';
import { getAllReceipts } from '../lib/database';
import { getCurrency } from '../lib/secureStorage';
import { CurrencyCode, formatCurrency } from '../lib/currency';
import { parseYmdLocal } from '../lib/parser';
import { Receipt } from '../types';

type Template = { receipt: Receipt; nextDueDate: string; endDate: string; frequency: string };

const FREQUENCY_LABEL: Record<string, string> = {
  weekly: 'Weekly',
  monthly: 'Monthly',
  yearly: 'Yearly',
};

/** Lists every active recurring-expense TEMPLATE (a receipt with
 *  `recurring` still set — generated occurrences clear that field, see
 *  lib/recurring.ts) and the date it'll next auto-add, so the user can
 *  see the whole upcoming schedule in one place instead of discovering
 *  each occurrence only after it's already been added. */
export default function RecurringScreen() {
  const theme = useTheme();
  const router = useRouter();
  const styles = useRecurringStyles();
  const [loading, setLoading] = useState(true);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [currency, setCurrency] = useState<CurrencyCode>('USD');

  useFocusEffect(
    useCallback(() => {
      let mounted = true;
      (async () => {
        const [receipts, rawCurrency] = await Promise.all([getAllReceipts(), getCurrency()]);
        if (!mounted) return;
        const active = (receipts as Receipt[])
          .filter((r) => r.recurring)
          .map((r) => ({
            receipt: r,
            nextDueDate: r.recurring!.nextDueDate,
            endDate: r.recurring!.endDate,
            frequency: r.recurring!.frequency,
          }))
          .sort((a, b) => a.nextDueDate.localeCompare(b.nextDueDate));
        setTemplates(active);
        if (rawCurrency) setCurrency(rawCurrency as CurrencyCode);
        setLoading(false);
      })();
      return () => {
        mounted = false;
      };
    }, []),
  );

  const formatScheduleDate = (ymd: string): string => {
    const d = parseYmdLocal(ymd);
    return d ? format(d, 'MMM d, yyyy') : ymd;
  };

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
      <ModalHeader title="Recurring" onBack={() => router.back()} />
      {!loading && templates.length === 0 ? (
        <EmptyState
          icon="repeat-outline"
          title="No recurring expenses"
          description={'Turn on "Repeat this expense" when adding or editing an expense to see its schedule here.'}
        />
      ) : (
        <ScrollView contentContainerStyle={styles.scroll}>
          {templates.map(({ receipt: r, nextDueDate, endDate, frequency }) => (
            <TouchableOpacity
              key={r.id}
              activeOpacity={0.7}
              style={styles.card}
              onPress={() => router.push(`/edit/${r.id}`)}
            >
              <View style={styles.row}>
                <View style={[styles.categoryDot, { backgroundColor: theme.colors.category[r.category] }]} />
                <View style={{ flex: 1, marginLeft: theme.spacing.md }}>
                  <Text style={styles.name} numberOfLines={1}>{r.storeName}</Text>
                  <Text style={styles.meta}>
                    {FREQUENCY_LABEL[frequency] ?? frequency} · Next: {formatScheduleDate(nextDueDate)}
                  </Text>
                  <Text style={styles.metaMuted}>Ends {formatScheduleDate(endDate)}</Text>
                </View>
                <Text style={styles.amount}>{formatCurrency(r.totalAmount, currency)}</Text>
              </View>
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function useRecurringStyles() {
  return useStyles((theme) => ({
    screen: { flex: 1, backgroundColor: theme.colors.background },
    scroll: {
      paddingHorizontal: theme.spacing.lg,
      paddingTop: theme.spacing.lg,
      paddingBottom: theme.spacing.xl,
    },
    card: {
      backgroundColor: theme.colors.surface,
      borderRadius: theme.radius.lg,
      borderWidth: 1,
      borderColor: theme.colors.border,
      marginBottom: theme.spacing.sm,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: theme.spacing.md,
      paddingVertical: theme.spacing.md,
    },
    categoryDot: {
      width: 12,
      height: 12,
      borderRadius: theme.radius.full,
    },
    name: {
      color: theme.colors.textPrimary,
      fontSize: theme.font.md,
      fontFamily: theme.fonts.display.bold,
    },
    meta: {
      color: theme.colors.textSecondary,
      fontSize: theme.font.xs,
      fontFamily: theme.fonts.body.regular,
      marginTop: 2,
    },
    metaMuted: {
      color: theme.colors.textMuted,
      fontSize: theme.font.xs,
      fontFamily: theme.fonts.body.regular,
      marginTop: 1,
    },
    amount: {
      fontSize: theme.font.md,
      fontFamily: theme.fonts.display.extraBold,
      color: theme.colors.textPrimary,
    },
  }));
}
