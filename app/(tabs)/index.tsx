import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, View, Text, ScrollView, TouchableOpacity, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { addMonths, format, isSameMonth, isToday, isYesterday, subMonths } from 'date-fns';
import { getCurrentHouseholdId, getReceiptsByMonth } from '../../lib/database';
import { getCategoryBudgets, getCurrency } from '../../lib/secureStorage';
import { checkBudgetsAndNotify } from '../../lib/notifications';
import { formatCurrency, CurrencyCode } from '../../lib/currency';
import { Receipt, MonthlyStats } from '../../types';
import { useStyles, useTheme } from '../../constants/theme';
import { EmptyState } from '../../components/ui/EmptyState';
import { computeStats } from '../../lib/dashboardStats';
import { RECURRING_BUDGET_KEY, isRecurringExpense } from '../../lib/recurring';
import { useAuth } from '../../lib/AuthContext';
import { onLocalDataChanged } from '../../lib/dataSync';

function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

function dateLabel(date: Date): string {
  if (isToday(date)) return 'Today';
  if (isYesterday(date)) return 'Yesterday';
  return format(date, 'MMM d');
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
  const { memberships } = useAuth();
  const styles = useStyles((t) => ({
    screen: { flex: 1, backgroundColor: t.colors.background },
    content: {
      paddingHorizontal: 20,
      paddingTop: t.spacing.lg,
      paddingBottom: 32,
      gap: t.spacing.lg,
    },
    householdRow: {
      flexDirection: 'row',
    },
    householdChip: {
      flexDirection: 'row',
      alignItems: 'center',
      alignSelf: 'flex-start',
      backgroundColor: t.colors.accent,
      borderRadius: t.radius.full,
      paddingHorizontal: 16,
      paddingVertical: 10,
      gap: 8,
      maxWidth: '90%',
      shadowColor: t.colors.accent,
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.35,
      shadowRadius: 6,
      elevation: 4,
    },
    householdRowName: {
      flexShrink: 1,
      color: '#fff',
      fontSize: t.font.md,
      fontFamily: t.fonts.display.bold,
    },

    heroCard: {
      borderRadius: t.radius.lg,
      paddingHorizontal: 22,
      paddingVertical: 20,
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
      marginTop: 4,
    },
    monthNavBtn: {
      padding: 4,
    },
    monthNavLabel: {
      color: 'rgba(255,255,255,0.85)',
      fontFamily: t.fonts.display.bold,
      fontSize: 13,
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
      color: t.colors.textMuted,
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
    budgetStatusText: { fontFamily: t.fonts.display.bold, fontSize: t.font.xs },
    budgetAmounts: {
      color: t.colors.textSecondary,
      fontFamily: t.fonts.mono.regular,
      fontSize: t.font.xs,
      marginTop: 6,
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

    list: { gap: t.spacing.sm },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: t.colors.surface,
      borderRadius: t.radius.lg,
      padding: t.spacing.md,
      borderWidth: 1,
      borderColor: t.colors.border,
      justifyContent: 'space-between',
    },
    rowLeft: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: t.spacing.sm,
      flex: 1,
    },
    avatar: {
      width: 40,
      height: 40,
      borderRadius: t.radius.full,
      alignItems: 'center',
      justifyContent: 'center',
      flexShrink: 0,
    },
    avatarText: {
      fontFamily: t.fonts.display.bold,
      fontSize: t.font.md,
      color: '#fff',
    },
    rowInfo: { flex: 1, gap: 2 },
    merchantName: {
      fontFamily: t.fonts.display.bold,
      fontSize: t.font.md,
      color: t.colors.textPrimary,
    },
    rowMeta: {
      fontFamily: t.fonts.body.regular,
      fontSize: t.font.xs,
      color: t.colors.textMuted,
    },
    rowAmount: {
      fontFamily: t.fonts.mono.medium,
      fontSize: t.font.md,
      color: t.colors.textPrimary,
      paddingLeft: t.spacing.sm,
    },
  }));

  const [currency, setCurrency] = useState<CurrencyCode>('USD');
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
  // 0 = current calendar month, negative = further back. Lets the
  // dashboard browse older months instead of only ever showing "now".
  const [monthOffset, setMonthOffset] = useState(0);
  const viewedMonth = addMonths(new Date(), monthOffset);
  const isCurrentMonth = isSameMonth(viewedMonth, new Date());

  const load = useCallback(async () => {
    const prevMonth = subMonths(viewedMonth, 1);
    const householdId = getCurrentHouseholdId();
    const [data, prevData, budgetMap, currencyCode] = await Promise.all([
      getReceiptsByMonth(viewedMonth.getFullYear(), viewedMonth.getMonth() + 1),
      getReceiptsByMonth(prevMonth.getFullYear(), prevMonth.getMonth() + 1),
      householdId ? getCategoryBudgets(householdId) : Promise.resolve({}),
      getCurrency(),
    ]);
    setReceipts(data);
    setStats(computeStats(data));
    setLastMonthTotal(prevData.reduce((s, r) => s + r.totalAmount, 0));
    setBudgets(budgetMap);
    setCurrency((currencyCode as CurrencyCode | null) ?? 'USD');
  }, [monthOffset]);

  useFocusEffect(
    useCallback(() => {
      load();
      // Fire-and-forget: checkBudgetsAndNotify handles its own toggle +
      // OS-permission gating and once/day throttling, so this call site
      // just needs to trigger it without blocking the data load above.
      checkBudgetsAndNotify().catch(() => {});
    }, [load]),
  );

  // useFocusEffect only fires on navigation focus changes — if Home was
  // already the focused screen when the app got backgrounded (e.g. a
  // shared-expense/settle-up push was tapped while Home was already
  // open), resuming the app is an AppState change with no navigation
  // event, so the load above would otherwise never refire and the
  // screen would show stale data despite "opening."
  const appState = useRef(AppState.currentState);
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (appState.current !== 'active' && nextState === 'active') {
        load();
        checkBudgetsAndNotify().catch(() => {});
      }
      appState.current = nextState;
    });
    return () => subscription.remove();
  }, [load]);

  // Firestore listeners (cloudSync.ts) write cloud changes into local
  // SQLite/SecureStore asynchronously, on their own schedule — often
  // AFTER the AppState/focus reload above already ran (e.g. resuming
  // from a notification tap races the listener reconnecting), and also
  // any time another household member's change arrives while this
  // screen is sitting open in the foreground. Reload whenever that
  // actually happens instead of only on navigation/AppState events.
  useEffect(() => onLocalDataChanged(() => load()), [load]);

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const recentReceipts = receipts.slice(0, 4);

  const trendPct =
    lastMonthTotal && lastMonthTotal > 0
      ? Math.round(((stats.totalSpent - lastMonthTotal) / lastMonthTotal) * 100)
      : null;

  // Budgets track against what actually left the wallet — each receipt's
  // full totalAmount (tax included) under its PRIMARY category. This is
  // deliberately NOT stats.categories: that breakdown sums per-LINE-ITEM
  // amounts (pre-tax, split across a receipt's multiple categories) for
  // Reports' finer-grained view, which is correct there but means a
  // receipt's tax never shows up anywhere — confusing for a "spent X of
  // Y limit" budget number, which should match the real total spent.
  const categorySpendForBudgets: Record<string, number> = {};
  for (const r of receipts) {
    categorySpendForBudgets[r.category] =
      (categorySpendForBudgets[r.category] ?? 0) + r.totalAmount;
    // "Recurring" is normally a separate axis, not a real category — a
    // receipt still counts toward its own category's budget too. Skip
    // the double-add for a receipt whose category IS literally
    // "Recurring" (the selectable category, which auto-enables the
    // repeat toggle) — the loop above already added it once under
    // that exact same key.
    if (isRecurringExpense(r) && r.category !== RECURRING_BUDGET_KEY) {
      categorySpendForBudgets[RECURRING_BUDGET_KEY] =
        (categorySpendForBudgets[RECURRING_BUDGET_KEY] ?? 0) + r.totalAmount;
    }
  }
  const budgetRows = Object.entries(categorySpendForBudgets)
    .filter(([category]) => (budgets[category] ?? 0) > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([category, spent]) => ({
      category,
      spent,
      limit: budgets[category],
      status: budgetStatus(spent, budgets[category]),
    }));

  const statusMeta: Record<BudgetStatus, { label: string; color: string }> = {
    onTrack: { label: 'On track', color: theme.colors.success },
    watch: { label: 'Watch', color: theme.colors.accent },
    over: { label: 'Over', color: theme.colors.error },
  };

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <ScrollView
        style={styles.screen}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.colors.accent} />
        }
      >
        {/* Active household + switcher */}
        <View style={styles.householdRow}>
          <TouchableOpacity
            style={styles.householdChip}
            onPress={() => router.push('/households' as never)}
          >
            <Ionicons name="home" size={16} color="#fff" />
            <Text style={styles.householdRowName} numberOfLines={1}>
              {memberships.find((m) => m.householdId === getCurrentHouseholdId())?.name ||
                'Unnamed household'}
            </Text>
            <Ionicons name="swap-horizontal" size={18} color="#fff" />
          </TouchableOpacity>
        </View>
  
        {/* Hero total card */}
        <View style={styles.heroCard}>
          <View style={styles.heroDecorCircle} />
          <Ionicons name="receipt" size={120} color="#fff" style={styles.heroDecorWatermark} />
          <Text style={styles.heroLabel}>{greeting()}</Text>
          <Text style={styles.heroAmount}>{formatCurrency(stats.totalSpent, currency)}</Text>
          <View style={styles.monthNavRow}>
            <TouchableOpacity
              onPress={() => setMonthOffset((v) => v - 1)}
              hitSlop={8}
              style={styles.monthNavBtn}
            >
              <Ionicons name="chevron-back" size={16} color="rgba(255,255,255,0.85)" />
            </TouchableOpacity>
            <Text style={styles.monthNavLabel}>{format(viewedMonth, 'MMMM yyyy')}</Text>
            <TouchableOpacity
              onPress={() => setMonthOffset((v) => v + 1)}
              disabled={isCurrentMonth}
              hitSlop={8}
              style={styles.monthNavBtn}
            >
              <Ionicons
                name="chevron-forward"
                size={16}
                color={isCurrentMonth ? 'rgba(255,255,255,0.3)' : 'rgba(255,255,255,0.85)'}
              />
            </TouchableOpacity>
          </View>
          <View style={styles.heroMetaRow}>
            <Text style={styles.heroMetaText}>
              {stats.receiptCount} expense{stats.receiptCount === 1 ? '' : 's'}{' '}
              {isCurrentMonth ? 'this month' : 'that month'}
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
        </View>
  
        {/* Quick actions */}
        <View style={styles.actionRow}>
          <TouchableOpacity
            style={styles.actionBtn}
            onPress={() => router.push('/(tabs)/scan?mode=manual' as never)}
          >
            <Text style={styles.actionBtnText}>+ Add manually</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.actionBtn} onPress={() => router.push('/recurring' as never)}>
            <Text style={styles.actionBtnText}>Recurring</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.actionBtn} onPress={() => router.push('/balances' as never)}>
            <Text style={styles.actionBtnText}>Balances</Text>
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
                const catColor =
                  b.category === RECURRING_BUDGET_KEY
                    ? theme.colors.accent
                    : theme.colors.category[b.category as keyof typeof theme.colors.category];
                const ratio = b.limit > 0 ? Math.min(b.spent / b.limit, 1) : 0;
                return (
                  <View key={b.category} style={[styles.budgetRow, i === 0 && styles.budgetRowFirst]}>
                    <View style={[styles.budgetAccent, { backgroundColor: catColor }]} />
                    <View style={styles.budgetInfo}>
                      <View style={styles.budgetNameRow}>
                        <Text style={styles.budgetName}>{b.category}</Text>
                        <Text style={[styles.budgetStatusText, { color: meta.color }]}>{meta.label}</Text>
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
                        {formatCurrency(b.spent, currency)} of {formatCurrency(b.limit, currency)}
                      </Text>
                    </View>
                  </View>
                );
              })}
            </View>
          </View>
        )}
  
        {/* Recent expenses */}
        {recentReceipts.length > 0 && (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Recent</Text>
              <TouchableOpacity onPress={() => router.push('/(tabs)/history' as never)} hitSlop={8}>
                <Text style={styles.sectionLink}>See all</Text>
              </TouchableOpacity>
            </View>
            <View style={styles.list}>
              {recentReceipts.map((r) => {
                const color = theme.colors.category[r.category as keyof typeof theme.colors.category];
                return (
                  <TouchableOpacity
                    key={r.id}
                    style={styles.row}
                    activeOpacity={0.8}
                    onPress={() => router.push(`/edit/${r.id}` as never)}
                  >
                    <View style={styles.rowLeft}>
                      <View style={[styles.avatar, { backgroundColor: color }]}>
                        <Text style={styles.avatarText}>{r.storeName.charAt(0).toUpperCase()}</Text>
                      </View>
                      <View style={styles.rowInfo}>
                        <Text style={styles.merchantName} numberOfLines={1}>
                          {r.storeName}
                        </Text>
                        <Text style={styles.rowMeta}>
                          {r.category} · {dateLabel(new Date(r.date))}
                        </Text>
                      </View>
                    </View>
                    <Text style={styles.rowAmount}>{formatCurrency(r.totalAmount, currency)}</Text>
                  </TouchableOpacity>
                );
              })}
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
      </ScrollView>
    </SafeAreaView>
  );
}
