import React, { useCallback, useState } from 'react';
import { Alert, ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { format } from 'date-fns';
import { ModalHeader } from '../components/ui/ModalHeader';
import { EmptyState } from '../components/ui/EmptyState';
import { useStyles, useTheme } from '../constants/theme';
import { CATEGORY_ICONS } from '../constants/categories';
import {
  clearReviewQueue,
  deleteReceipt,
  getReviewQueueReceipts,
  removeFromReviewQueue,
} from '../lib/database';
import { getCurrency } from '../lib/secureStorage';
import { CurrencyCode, formatCurrency } from '../lib/currency';
import { parseYmdLocal } from '../lib/parser';
import { Receipt } from '../types';

import { useT } from '../lib/I18nContext';
/** Review inbox: expenses the app added on its own (recurring
 *  occurrences) wait here until the user confirms, edits, or deletes
 *  them — so an auto-added charge never silently skews the month. */
export default function ReviewScreen() {
  const t = useT();
  const theme = useTheme();
  const router = useRouter();
  const styles = useReviewStyles();
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<Receipt[]>([]);
  const [currency, setCurrency] = useState<CurrencyCode>('USD');
  const [loadFailed, setLoadFailed] = useState(false);

  const load = useCallback(async () => {
    const [rows, rawCurrency] = await Promise.all([getReviewQueueReceipts(), getCurrency()]);
    setItems(rows);
    setLoadFailed(false);
    if (rawCurrency) setCurrency(rawCurrency as CurrencyCode);
    setLoading(false);
  }, []);

  useFocusEffect(
    useCallback(() => {
      load().catch(() => {
        setLoadFailed(true);
        setLoading(false);
      });
    }, [load]),
  );

  // Every mutation goes through here so a DB failure shows an alert
  // instead of an unhandled promise rejection and a stale list.
  const run = async (action: () => Promise<void>) => {
    try {
      await action();
      await load();
    } catch {
      Alert.alert(t('somethingWentWrong'), t('pleaseTryAgain'));
    }
  };

  const approve = (id: string) => run(() => removeFromReviewQueue(id));

  const approveAll = () => run(() => clearReviewQueue());

  const confirmDelete = (r: Receipt) => {
    Alert.alert(t('deleteExpense2'), `${r.storeName} will be removed.`, [
      { text: t('cancel'), style: 'cancel' },
      {
        text: t('delete'),
        style: 'destructive',
        onPress: () => run(() => deleteReceipt(r.id)),
      },
    ]);
  };

  const formatDate = (ymd: string): string => {
    const d = parseYmdLocal(ymd);
    return d ? format(d, 'MMM d, yyyy') : ymd;
  };

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
      <ModalHeader title={t('review')} onBack={() => router.back()} />
      {!loading && loadFailed ? (
        <EmptyState
          icon="alert-circle-outline"
          title={t('couldnTLoadReviewItems')}
          description={t('pullBackAndReopenThis')}
        />
      ) : !loading && items.length === 0 ? (
        <EmptyState
          icon="checkmark-done-outline"
          title={t('allCaughtUp')}
          description={t('recurringExpensesTheAppAdds')}
        />
      ) : (
        <ScrollView contentContainerStyle={styles.scroll}>
          <TouchableOpacity
            testID="review-approve-all"
            style={styles.approveAll}
            onPress={approveAll}
            accessibilityRole="button"
          >
            <Text style={styles.approveAllText}>Looks good — approve all ({items.length})</Text>
          </TouchableOpacity>
          {items.map((r) => (
            <View
              key={r.id}
              testID={`review-row-${r.id}`}
              style={[styles.card, { borderLeftColor: theme.colors.category[r.category] }]}
            >
              <View style={styles.row}>
                <View
                  style={[
                    styles.categoryIcon,
                    { backgroundColor: `${theme.colors.category[r.category]}26` },
                  ]}
                >
                  <Text style={styles.categoryIconGlyph}>{CATEGORY_ICONS[r.category] ?? '🔁'}</Text>
                </View>
                <View style={{ flex: 1, marginLeft: theme.spacing.md }}>
                  <Text style={styles.name} numberOfLines={1}>{r.storeName}</Text>
                  <Text style={styles.meta}>
                    {r.category} · {formatDate(r.date)}
                  </Text>
                </View>
                <Text style={styles.amount}>{formatCurrency(r.totalAmount, currency)}</Text>
              </View>
              <View style={styles.actions}>
                <TouchableOpacity
                  testID={`review-approve-${r.id}`}
                  style={styles.actionBtn}
                  onPress={() => approve(r.id)}
                  accessibilityRole="button"
                >
                  <Text style={[styles.actionText, { color: theme.colors.success }]}>{t('looksGood')}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  testID={`review-edit-${r.id}`}
                  style={styles.actionBtn}
                  onPress={() => router.push(`/edit/${r.id}`)}
                  accessibilityRole="button"
                >
                  <Text style={styles.actionText}>{t('edit')}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  testID={`review-delete-${r.id}`}
                  style={styles.actionBtn}
                  onPress={() => confirmDelete(r)}
                  accessibilityRole="button"
                >
                  <Text style={[styles.actionText, { color: theme.colors.error }]}>{t('delete')}</Text>
                </TouchableOpacity>
              </View>
            </View>
          ))}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function useReviewStyles() {
  return useStyles((theme) => ({
    screen: { flex: 1, backgroundColor: theme.colors.background },
    scroll: {
      paddingHorizontal: theme.spacing.lg,
      paddingTop: theme.spacing.lg,
      paddingBottom: theme.spacing.xl,
    },
    approveAll: {
      backgroundColor: theme.colors.accent,
      borderRadius: 16,
      paddingVertical: 14,
      alignItems: 'center',
      marginBottom: theme.spacing.md,
    },
    approveAllText: {
      color: '#fff',
      fontSize: theme.font.md,
      fontFamily: theme.fonts.display.bold,
    },
    card: {
      backgroundColor: theme.colors.surface,
      borderRadius: 20,
      marginBottom: theme.spacing.sm,
      borderLeftWidth: 3,
      shadowColor: theme.isDark ? '#000' : '#0C0F24',
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: theme.isDark ? 0.4 : 0.08,
      shadowRadius: 10,
      elevation: 2,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: theme.spacing.md,
      paddingTop: theme.spacing.md,
      paddingBottom: theme.spacing.sm,
    },
    categoryIcon: {
      width: 40,
      height: 40,
      borderRadius: 14,
      alignItems: 'center',
      justifyContent: 'center',
      flexShrink: 0,
    },
    categoryIconGlyph: { fontSize: 17 },
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
    amount: {
      fontSize: theme.font.md,
      fontFamily: theme.fonts.mono.medium,
      color: theme.colors.textPrimary,
    },
    actions: {
      flexDirection: 'row',
      justifyContent: 'space-around',
      borderTopWidth: 1,
      borderTopColor: theme.colors.border,
      paddingVertical: theme.spacing.sm,
    },
    actionBtn: { paddingHorizontal: theme.spacing.md, paddingVertical: 4 },
    actionText: {
      color: theme.colors.textPrimary,
      fontSize: theme.font.sm,
      fontFamily: theme.fonts.display.bold,
    },
  }));
}
