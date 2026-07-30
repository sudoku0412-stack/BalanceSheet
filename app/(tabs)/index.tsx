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

// Exact thresholds from the design spec: ≤70% = on track, 70-90% =
// watch, >90% = over (the progress bar itself also turns error-red
// past 90%, independent of the status-chip color).
function budgetStatus(spent: number, limit: number): BudgetStatus {
  const ratio = limit > 0 ? spent / limit : 0;
  if (ratio > 0.9) return 'over';
  if (ratio > 0.7) return 'watch';
  return 'onTrack';
}

export default function DashboardScreen() {
  const theme = useTheme();
  const styles = useStyles((t) => ({
    screen: { flex: 1, backgroundColor: t.colors.background },
    content: { padding: t.spacing.md, gap: t.spacing.lg, paddingBottom: 32 },

    heroCard: {
      borderRadius: t.radius.lg,
      paddingHorizontal: 20,
      paddingVertical: 22,
      backgroundColor: t.colors.primary,
      overflow: 'hidden',
      position: 'relative',
    },
    heroDecorCircle: {
      position: 'absolute',
      top: -40,
      right: -40,
      width: 140,
      height: 140,
      borderRadius: t.radius.full,
      backgroundColor: 'rgba(255,255,255,0.08)',
    },
    heroDecorWatermark: {
      position: 'absolute',
      bottom: -18,
      right: -10,
      opacity: 0.08,
    },
    heroLabel: {
      color: 'rgba(255,255,255,0.6)',
      fontFamily: t.fonts.display.bold,
      fontSize: 11,
      letterSpacing: 1.2,
      textTransform: 'uppercase',
    },
    heroAmount: {
      color: '#fff',
      fontFamily: t.fonts.mono.medium,
      fontSize: 38,
      marginTop: 4,
    },
    heroMetaRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: t.spacing.sm,
      marginTop: t.spacing.sm,
    },
    heroMetaText: {
      color: 'rgba(255,255,255,0.6)',
      fontFamily: t.fonts.body.regular,
      fontSize: 12,
    },
    trendPill: {
      paddingHorizontal: 10,
      paddingVertical: 3,
      borderRadius: t.radius.full,
      backgroundColor: 'rgba(255,255,255,0.12)',
    },
    trendPillText: { fontFamily: t.fonts.display.bold, fontSize: 10 },

    monthNavRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: t.spacing.xs,
      marginTop: t.spacing.sm,
    },
    monthNavLabel: {
      color: 'rgba(255,255,255,0.6)',
      fontFamily: t.fonts.body.medium,
      fontSize: t.font.xs,
    },

    actionRow: {
      flexDirection: 'row',
      gap: t.spacing.sm,
    },
    actionBtn: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      height: 44,
      borderRadius: t.radius.sm,
      borderWidth: 1,
      borderColor: t.colors.border,
      backgroundColor: t.colors.surface,
    },
    actionBtnText: {
      color: t.colors.textPrimary,
      fontFamily: t.fonts.display.bold,
      fontSize: t.font.sm,
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
      fontFamily: t.fonts.display.bold,
      fontSize: 12,
      letterSpacing: 1,
      textTransform: 'uppercase',
    },
    sectionLink: {
      color: t.colors.accent,
      fontFamily: t.fonts.display.bold,
      fontSize: t.font.sm,
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
    budgetNameRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    budgetName: { color: t.colors.textPrimary, fontFamily: t.fonts.display.bold, fontSize: t.font.md },
    budgetAmounts: {
      color: t.colors.textSecondary,
      fontFamily: t.fonts.mono.regular,
      fontSize: t.font.xs,
      marginTop: 2,
    },
    progressTrack: {
      height: 6,
      borderRadius: t.radius.full,
      backgroundColor: t.colors.surfaceHigh,
      marginTop: 6,
      overflow: 'hidden',
    },
    progressFill: {
      height: 6,
      borderRadius: t.radius.full,
    },
    statusPill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: t.radius.full },
    statusPillText: { fontFamily: t.fonts.display.bold, fontSize: t.font.xs },

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
    .slice(0, 3)
    .map((c) => ({
      category: c.category,
      spent: c.total,
      limit: budgets[c.category],
      status: budgetStatus(c.total, budgets[c.category]),
    }));

  const statusMeta: Record<BudgetStatus, { label: string; color: string; faint: string }> = {
    onTrack: { label: 'ON TRACK', color: theme.colors.success, faint: theme.colors.successFaint },
    watch: { label: 'WATCH', color: theme.colors.accent, faint: `${theme.colors.accent}22` },
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
        <View style={styles.heroDecorCircle} />
        <Ionicons
          name="receipt"
          size={120}
          color="#fff"
          style={styles.heroDecorWatermark}
        />
        <Text style={styles.heroLabel}>{greeting()}</Text>
        <Text style={styles.heroAmount}>${stats.totalSpent.toFixed(2)}</Text>
        <View style={styles.heroMetaRow}>
          <Text style={styles.heroMetaText}>
            {stats.receiptCount} expense{stats.receiptCount === 1 ? '' : 's'} this month
          </Text>
          {trendPct != null && (
            <View style={styles.trendPill}>
              <Text
                style={[
                  styles.trendPillText,
                  { color: trendPct <= 0 ? '#9FE0C8' : '#F0B4B6' },
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
            <Ionicons name="chevron-back" size={16} color="rgba(255,255,255,0.6)" />
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
            <Ionicons name="chevron-forward" size={16} color="rgba(255,255,255,0.6)" />
          </TouchableOpacity>
        </View>
      </View>

      {/* Quick actions */}
      <View style={styles.actionRow}>
        <TouchableOpacity style={styles.actionBtn} onPress={() => router.push('/(tabs)/scan')}>
          <Text style={styles.actionBtnText}>+ Add manually</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.actionBtn} onPress={() => router.push('/reports' as never)}>
          <Text style={styles.actionBtnText}>Reports</Text>
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
              const catColor = theme.colors.category[b.category as keyof typeof theme.colors.category];
              const ratio = b.limit > 0 ? Math.min(b.spent / b.limit, 1) : 0;
              return (
                <View
                  key={b.category}
                  style={[styles.budgetRow, i === 0 && styles.budgetRowFirst]}
                >
                  <View style={[styles.budgetAccent, { backgroundColor: catColor }]} />
                  <View style={styles.budgetInfo}>
                    <View style={styles.budgetNameRow}>
                      <Text style={styles.budgetName}>{b.category}</Text>
                      <View style={[styles.statusPill, { backgroundColor: meta.faint }]}>
                        <Text style={[styles.statusPillText, { color: meta.color }]}>{meta.label}</Text>
                      </View>
                    </View>
                    <View style={styles.progressTrack}>
                      <View
                        style={[
                          styles.progressFill,
                          {
                            width: `${ratio * 100}%`,
                            backgroundColor: ratio > 0.9 ? theme.colors.error : catColor,
                          },
                        ]}
                      />
                    </View>
                    <Text style={styles.budgetAmounts}>
                      ${b.spent.toFixed(2)} of ${b.limit.toFixed(2)}
                    </Text>
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
