import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
} from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { format, subMonths } from 'date-fns';
import { getReceiptsByMonth, deleteReceipt } from '../../lib/database';
import { getCategoryBudgets } from '../../lib/secureStorage';
import { Receipt, MonthlyStats } from '../../types';
import { useStyles, useTheme } from '../../constants/theme';
import { ReceiptCard } from '../../components/receipt/ReceiptCard';
import { EmptyState } from '../../components/ui/EmptyState';
import { MonthYearPicker } from '../../components/ui/MonthYearPicker';
import { useToast } from '../../components/ui/Toast';
import { tapMedium } from '../../lib/haptics';
import { computeStats } from '../../lib/dashboardStats';

function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

type BudgetStatus = 'onTrack' | 'watch' | 'over';

function budgetStatus(spent: number, limit: number): BudgetStatus {
  const ratio = limit > 0 ? spent / limit : 0;
  if (ratio >= 1) return 'over';
  if (ratio >= 0.8) return 'watch';
  return 'onTrack';
}

export default function DashboardScreen() {
  const theme = useTheme();
  const styles = useStyles((t) => ({
    screen: { flex: 1, backgroundColor: t.colors.background },
    content: { padding: t.spacing.md, gap: t.spacing.lg, paddingBottom: 32 },

    heroCard: {
      borderRadius: t.radius.xl,
      padding: t.spacing.lg,
      backgroundColor: t.colors.surfaceHigh,
      overflow: 'hidden',
    },
    heroLabel: {
      color: t.colors.textSecondary,
      fontSize: t.font.xs,
      fontWeight: '700',
      letterSpacing: 1.2,
      textTransform: 'uppercase',
    },
    heroAmount: {
      color: t.colors.textPrimary,
      fontSize: 42,
      fontWeight: '800',
      letterSpacing: -1,
      marginTop: 4,
    },
    heroMetaRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: t.spacing.sm,
      marginTop: t.spacing.sm,
    },
    heroMetaText: {
      color: t.colors.textSecondary,
      fontSize: t.font.sm,
    },
    trendPill: {
      paddingHorizontal: 10,
      paddingVertical: 3,
      borderRadius: t.radius.full,
    },
    trendPillDown: { backgroundColor: t.colors.successFaint },
    trendPillUp: { backgroundColor: t.colors.errorFaint },
    trendPillText: { fontSize: t.font.xs, fontWeight: '700' },

    monthNavRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: t.spacing.xs,
      marginTop: t.spacing.sm,
    },
    monthNavLabel: {
      color: t.colors.textMuted,
      fontSize: t.font.xs,
      fontWeight: '600',
    },

    actionRow: {
      flexDirection: 'row',
      gap: t.spacing.sm,
    },
    actionBtn: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: 14,
      borderRadius: t.radius.md,
      borderWidth: 1,
      borderColor: t.colors.border,
      backgroundColor: t.colors.surface,
    },
    actionBtnText: {
      color: t.colors.textPrimary,
      fontSize: t.font.sm,
      fontWeight: '700',
      letterSpacing: 0.3,
    },

    section: { gap: t.spacing.sm },
    sectionHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    sectionTitle: {
      color: t.colors.textPrimary,
      fontSize: t.font.xs,
      fontWeight: '700',
      letterSpacing: 1,
      textTransform: 'uppercase',
    },
    sectionLink: {
      color: t.colors.primary,
      fontSize: t.font.sm,
      fontWeight: '600',
    },

    budgetCard: {
      backgroundColor: t.colors.surface,
      borderRadius: t.radius.lg,
      borderWidth: 1,
      borderColor: t.colors.border,
      overflow: 'hidden',
    },
    budgetRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: t.spacing.sm,
      paddingRight: t.spacing.md,
      borderTopWidth: 1,
      borderTopColor: t.colors.border,
    },
    budgetRowFirst: { borderTopWidth: 0 },
    budgetAccent: { width: 4, height: '100%', marginRight: t.spacing.md },
    budgetInfo: { flex: 1 },
    budgetName: { color: t.colors.textPrimary, fontSize: t.font.md, fontWeight: '600' },
    budgetAmounts: { color: t.colors.textSecondary, fontSize: t.font.xs, marginTop: 2 },
    statusPill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: t.radius.full },
    statusPillText: { fontSize: t.font.xs, fontWeight: '700' },

    list: { gap: t.spacing.sm },
  }));

  const [activeMonth, setActiveMonth] = useState(new Date());
  const [pickerOpen, setPickerOpen] = useState(false);
  const toast = useToast();
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [stats, setStats] = useState<MonthlyStats>({
    totalSpent: 0,
    receiptCount: 0,
    topCategory: null,
    avgPerReceipt: 0,
    categories: [],
  });
  const [lastMonthTotal, setLastMonthTotal] = useState<number | null>(null);
  const [budgets, setBudgets] = useState<Record<string, number>>({});
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const [data, prevData, budgetMap] = await Promise.all([
      getReceiptsByMonth(activeMonth.getFullYear(), activeMonth.getMonth() + 1),
      getReceiptsByMonth(
        subMonths(activeMonth, 1).getFullYear(),
        subMonths(activeMonth, 1).getMonth() + 1,
      ),
      getCategoryBudgets(),
    ]);
    setReceipts(data);
    setStats(computeStats(data));
    setLastMonthTotal(prevData.reduce((s, r) => s + r.totalAmount, 0));
    setBudgets(budgetMap);
  }, [activeMonth]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const handleDelete = (id: string) => {
    const target = receipts.find((r) => r.id === id);
    if (!target) return;
    tapMedium();
    // Optimistically remove from the list; defer DB delete 5s so the
    // user can tap Undo on the toast first.
    setReceipts((prev) => prev.filter((r) => r.id !== id));
    const timer = setTimeout(() => {
      deleteReceipt(id).then(load).catch(() => load());
    }, 5000);
    toast.show({
      message: `Deleted ${target.storeName}`,
      kind: 'success',
      undoLabel: 'Undo',
      onUndo: () => {
        clearTimeout(timer);
        load();
      },
      durationMs: 5000,
    });
  };

  const recentReceipts = receipts.slice(0, 4);

  const trendPct =
    lastMonthTotal && lastMonthTotal > 0
      ? Math.round(((stats.totalSpent - lastMonthTotal) / lastMonthTotal) * 100)
      : null;

  const budgetRows = stats.categories
    .filter((c) => (budgets[c.category] ?? 0) > 0)
    .map((c) => ({
      category: c.category,
      spent: c.total,
      limit: budgets[c.category],
      status: budgetStatus(c.total, budgets[c.category]),
    }));

  const statusMeta: Record<BudgetStatus, { label: string; color: string; faint: string }> = {
    onTrack: { label: 'ON TRACK', color: theme.colors.success, faint: theme.colors.successFaint },
    watch: { label: 'WATCH', color: theme.colors.primary, faint: theme.colors.primaryFaint },
    over: { label: 'OVER', color: theme.colors.error, faint: theme.colors.errorFaint },
  };

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.colors.primary} />
      }
    >
      {/* Hero total card */}
      <View style={styles.heroCard}>
        <Text style={styles.heroLabel}>{greeting()}</Text>
        <Text style={styles.heroAmount}>${stats.totalSpent.toFixed(2)}</Text>
        <View style={styles.heroMetaRow}>
          <Text style={styles.heroMetaText}>
            {stats.receiptCount} expense{stats.receiptCount === 1 ? '' : 's'} this month
          </Text>
          {trendPct != null && (
            <View style={[styles.trendPill, trendPct <= 0 ? styles.trendPillDown : styles.trendPillUp]}>
              <Text
                style={[
                  styles.trendPillText,
                  { color: trendPct <= 0 ? theme.colors.success : theme.colors.error },
                ]}
              >
                {trendPct > 0 ? '+' : ''}
                {trendPct}% vs last month
              </Text>
            </View>
          )}
        </View>

        <View style={styles.monthNavRow}>
          <TouchableOpacity onPress={() => setActiveMonth((m) => subMonths(m, 1))} hitSlop={10}>
            <Ionicons name="chevron-back" size={16} color={theme.colors.textMuted} />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => {
              tapMedium();
              setPickerOpen(true);
            }}
            hitSlop={10}
          >
            <Text style={styles.monthNavLabel}>{format(activeMonth, 'MMMM yyyy')}</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setActiveMonth((m) => subMonths(m, -1))} hitSlop={10}>
            <Ionicons name="chevron-forward" size={16} color={theme.colors.textMuted} />
          </TouchableOpacity>
        </View>
      </View>

      {/* Quick actions */}
      <View style={styles.actionRow}>
        <TouchableOpacity style={styles.actionBtn} onPress={() => router.push('/(tabs)/scan')}>
          <Text style={styles.actionBtnText}>+ ADD MANUALLY</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.actionBtn} onPress={() => router.push('/reports' as never)}>
          <Text style={styles.actionBtnText}>REPORTS</Text>
        </TouchableOpacity>
      </View>

      {/* Budgets */}
      {budgetRows.length > 0 && (
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Budgets</Text>
            <TouchableOpacity onPress={() => router.push('/settings' as never)} hitSlop={8}>
              <Text style={styles.sectionLink}>Manage</Text>
            </TouchableOpacity>
          </View>
          <View style={styles.budgetCard}>
            {budgetRows.map((b, i) => {
              const meta = statusMeta[b.status];
              return (
                <View
                  key={b.category}
                  style={[styles.budgetRow, i === 0 && styles.budgetRowFirst]}
                >
                  <View
                    style={[
                      styles.budgetAccent,
                      { backgroundColor: theme.colors.category[b.category as keyof typeof theme.colors.category] },
                    ]}
                  />
                  <View style={styles.budgetInfo}>
                    <Text style={styles.budgetName}>{b.category}</Text>
                    <Text style={styles.budgetAmounts}>
                      ${b.spent.toFixed(2)} of ${b.limit.toFixed(2)}
                    </Text>
                  </View>
                  <View style={[styles.statusPill, { backgroundColor: meta.faint }]}>
                    <Text style={[styles.statusPillText, { color: meta.color }]}>{meta.label}</Text>
                  </View>
                </View>
              );
            })}
          </View>
        </View>
      )}

      {/* Recent transactions */}
      {recentReceipts.length > 0 && (
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Recent</Text>
            <TouchableOpacity onPress={() => router.push('/(tabs)/history')} hitSlop={8}>
              <Text style={styles.sectionLink}>See all</Text>
            </TouchableOpacity>
          </View>
          <View style={styles.list}>
            {recentReceipts.map((r) => (
              <ReceiptCard key={r.id} receipt={r} onDelete={handleDelete} />
            ))}
          </View>
        </View>
      )}

      {receipts.length === 0 && (
        <EmptyState
          icon="receipt-outline"
          title="No receipts yet"
          description="Tap the camera button below to scan your first receipt and start tracking your spending."
          actionLabel="Scan a receipt"
          onAction={() => router.push('/(tabs)/scan')}
        />
      )}

      <MonthYearPicker
        visible={pickerOpen}
        selected={activeMonth}
        onClose={() => setPickerOpen(false)}
        onSelect={(d) => setActiveMonth(d)}
      />
    </ScrollView>
  );
}
