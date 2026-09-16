import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, View, Text, ScrollView, TouchableOpacity, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import Svg, { Circle } from 'react-native-svg';
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
import type { Profile } from '../../lib/profile';
import { onLocalDataChanged } from '../../lib/dataSync';
import { CATEGORY_ICONS, ALL_CATEGORIES } from '../../constants/categories';

/**
 * Single-arc radial progress ring, reusing the same react-native-svg
 * stroke-dasharray technique as reports.tsx's CategoryDonut (this repo's
 * one existing SVG-ring pattern) rather than introducing a second charting
 * approach. Unlike the donut (which draws one arc per category), this
 * draws a single progress arc against a track circle — used for both the
 * hero "pace" ring and the per-budget ring chips.
 *
 * `pct` is clamped to [0, 1] so a ratio over 100% still renders as a full
 * ring instead of overflowing/wrapping.
 */
function RingProgress({
  size,
  strokeWidth,
  pct,
  color,
  trackColor,
  testID,
}: {
  size: number;
  strokeWidth: number;
  pct: number;
  color: string;
  trackColor: string;
  testID?: string;
}) {
  const r = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * r;
  const center = size / 2;
  const clamped = Math.max(0, Math.min(pct, 1));
  const dash = clamped * circumference;
  return (
    <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} testID={testID}>
      <Circle cx={center} cy={center} r={r} stroke={trackColor} strokeWidth={strokeWidth} fill="none" />
      {clamped > 0 && (
        <Circle
          cx={center}
          cy={center}
          r={r}
          stroke={color}
          strokeWidth={strokeWidth}
          strokeDasharray={`${dash} ${circumference - dash}`}
          strokeLinecap="round"
          fill="none"
          rotation={-90}
          origin={`${center}, ${center}`}
        />
      )}
    </Svg>
  );
}

function greeting(firstName: string | null): string {
  const h = new Date().getHours();
  const base = h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
  return firstName ? `${base}, ${firstName}` : base;
}

// Firebase Auth's displayName is already auto-populated from Google/Apple
// sign-in (see lib/auth.ts) and backfilled for email/password accounts
// from the local profile (see AuthContext.tsx) — this just picks whichever
// is available and takes the first token, since the greeting has no room
// for a full name.
function firstNameOf(displayName: string | null | undefined, profile: Profile | null): string | null {
  const full = displayName?.trim() || (profile ? `${profile.firstName} ${profile.lastName}`.trim() : '');
  return full ? full.split(/\s+/)[0] : null;
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
  const { memberships, user, profile } = useAuth();
  const styles = useStyles((t) => ({
    screen: { flex: 1, backgroundColor: t.colors.background },
    content: {
      paddingHorizontal: 20,
      paddingTop: t.spacing.lg,
      paddingBottom: 100,
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
      borderRadius: 24,
      paddingHorizontal: 22,
      paddingVertical: 20,
      backgroundColor: t.colors.primary,
      overflow: 'hidden',
      position: 'relative',
      shadowColor: '#0C0F24',
      shadowOffset: { width: 0, height: 6 },
      shadowOpacity: 0.25,
      shadowRadius: 14,
      elevation: 4,
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
    heroAmountShrinkWrap: {
      flexShrink: 1,
      minWidth: 0,
    },
    heroAmountRow: {
      flexDirection: 'row',
      alignItems: 'flex-end',
      justifyContent: 'space-between',
      gap: t.spacing.sm,
    },
    paceRingWrap: {
      alignItems: 'center',
      flexShrink: 0,
    },
    paceRingCircleWrap: {
      width: 46,
      height: 46,
      alignItems: 'center',
      justifyContent: 'center',
    },
    paceRingPctText: {
      position: 'absolute',
      color: '#fff',
      fontFamily: t.fonts.display.bold,
      fontSize: 12,
    },
    paceRingCap: {
      color: 'rgba(255,255,255,0.55)',
      fontFamily: t.fonts.display.bold,
      fontSize: 8,
      letterSpacing: 0.5,
      textTransform: 'uppercase',
      marginTop: 3,
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

    compositionCard: {
      backgroundColor: t.colors.surface,
      borderRadius: 18,
      padding: t.spacing.md,
      shadowColor: t.isDark ? '#000' : '#0C0F24',
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: t.isDark ? 0.4 : 0.08,
      shadowRadius: 10,
      elevation: 2,
    },
    compositionHead: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'baseline',
      marginBottom: 9,
    },
    compNote: {
      fontFamily: t.fonts.body.regular,
      fontSize: t.font.xs,
      color: t.colors.textMuted,
    },
    compBar: {
      flexDirection: 'row',
      height: 8,
      borderRadius: t.radius.full,
      overflow: 'hidden',
      gap: 1.5,
    },
    compSegment: {
      height: '100%',
    },
    compLegend: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 10,
      marginTop: 9,
    },
    compLegendItem: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 5,
    },
    compDot: {
      width: 7,
      height: 7,
      borderRadius: t.radius.full,
    },
    compLegendText: {
      fontFamily: t.fonts.body.regular,
      fontSize: t.font.xs,
      color: t.colors.textSecondary,
    },

    actionRow: {
      flexDirection: 'row',
      gap: t.spacing.sm,
    },
    actionBtn: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
      paddingVertical: 14,
      borderRadius: 16,
      backgroundColor: t.colors.surface,
      shadowColor: t.isDark ? '#000' : '#0C0F24',
      shadowOffset: { width: 0, height: 3 },
      shadowOpacity: t.isDark ? 0.35 : 0.06,
      shadowRadius: 8,
      elevation: 1,
    },
    actionBtnText: {
      color: t.colors.textPrimary,
      fontFamily: t.fonts.display.bold,
      fontSize: t.font.xs,
      letterSpacing: 0.2,
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

    budgetScrollContent: {
      flexDirection: 'row',
      gap: t.spacing.sm,
    },
    budgetChip: {
      backgroundColor: t.colors.surface,
      borderRadius: 18,
      padding: 12,
      width: 112,
      shadowColor: t.isDark ? '#000' : '#0C0F24',
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: t.isDark ? 0.4 : 0.08,
      shadowRadius: 10,
      elevation: 2,
    },
    budgetChipTopRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    budgetChipStatusPill: {
      paddingHorizontal: 7,
      paddingVertical: 2,
      borderRadius: t.radius.full,
    },
    budgetChipStatusText: {
      fontFamily: t.fonts.display.bold,
      fontSize: 9,
    },
    budgetChipName: {
      color: t.colors.textPrimary,
      fontFamily: t.fonts.display.bold,
      fontSize: t.font.sm,
      marginTop: 9,
      marginBottom: 2,
    },
    budgetChipAmt: {
      color: t.colors.textMuted,
      fontFamily: t.fonts.mono.regular,
      fontSize: 10,
    },

    list: { gap: t.spacing.sm },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: t.colors.surface,
      borderRadius: 20,
      padding: t.spacing.md,
      justifyContent: 'space-between',
      shadowColor: t.isDark ? '#000' : '#0C0F24',
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: t.isDark ? 0.4 : 0.08,
      shadowRadius: 10,
      elevation: 2,
    },
    rowLeft: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: t.spacing.sm,
      flex: 1,
    },
    avatar: {
      width: 44,
      height: 44,
      borderRadius: 14,
      alignItems: 'center',
      justifyContent: 'center',
      flexShrink: 0,
    },
    avatarText: {
      fontSize: 20,
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

  const statusMeta: Record<BudgetStatus, { label: string; color: string; bg: string }> = {
    onTrack: { label: 'On track', color: theme.colors.success, bg: theme.colors.successFaint },
    watch: { label: 'Watch', color: theme.colors.accent, bg: theme.colors.accentTint },
    over: { label: 'Over', color: theme.colors.error, bg: theme.colors.errorFaint },
  };

  // Hero "pace" ring: how much of the WHOLE month's configured budget has
  // been spent so far, using every category budget the user has set (not
  // just the top-3 slice budgetRows truncates to for display below).
  // With no budgets configured at all there's nothing meaningful to show
  // a percentage of, so the ring is hidden entirely rather than rendering
  // a 0%/undefined ring.
  const totalBudget = Object.values(budgets).reduce((s, v) => s + (v > 0 ? v : 0), 0);
  const showPaceRing = totalBudget > 0;
  const paceRatio = showPaceRing ? Math.min(stats.totalSpent / totalBudget, 1) : 0;
  const paceStatus = showPaceRing ? budgetStatus(stats.totalSpent, totalBudget) : 'onTrack';
  const paceColor = statusMeta[paceStatus].color;

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
          <Text style={styles.heroLabel}>{greeting(firstNameOf(user?.displayName, profile))}</Text>
          <View style={styles.heroAmountRow}>
            <View style={styles.heroAmountShrinkWrap}>
              <Text
                style={styles.heroAmount}
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.5}
              >
                {formatCurrency(stats.totalSpent, currency)}
              </Text>
            </View>
            {showPaceRing && (
              <View style={styles.paceRingWrap}>
                <View style={styles.paceRingCircleWrap}>
                  <RingProgress
                    size={46}
                    strokeWidth={5}
                    pct={paceRatio}
                    color={paceColor}
                    trackColor="rgba(255,255,255,0.16)"
                    testID="pace-ring"
                  />
                  <Text style={styles.paceRingPctText}>{Math.round(paceRatio * 100)}%</Text>
                </View>
                <Text style={styles.paceRingCap}>of budget</Text>
              </View>
            )}
          </View>
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

        {/* "Where it went" category composition bar */}
        {stats.categories.length > 0 && (
          <View style={styles.compositionCard}>
            <View style={styles.compositionHead}>
              <Text style={styles.sectionTitle}>Where it went</Text>
              <Text style={styles.compNote}>{formatCurrency(stats.totalSpent, currency)} total</Text>
            </View>
            <View style={styles.compBar}>
              {stats.categories.map((c) => {
                const isStandard = (ALL_CATEGORIES as readonly string[]).includes(c.category);
                const color = isStandard
                  ? theme.colors.category[c.category as keyof typeof theme.colors.category]
                  : theme.colors.accent;
                return (
                  <View
                    key={c.category}
                    style={[
                      styles.compSegment,
                      { flex: Math.max(c.percentage, 0.001), backgroundColor: color },
                    ]}
                  />
                );
              })}
            </View>
            <View style={styles.compLegend}>
              {stats.categories.slice(0, 4).map((c) => {
                const isStandard = (ALL_CATEGORIES as readonly string[]).includes(c.category);
                const color = isStandard
                  ? theme.colors.category[c.category as keyof typeof theme.colors.category]
                  : theme.colors.accent;
                return (
                  <View key={c.category} style={styles.compLegendItem}>
                    <View style={[styles.compDot, { backgroundColor: color }]} />
                    <Text style={styles.compLegendText}>
                      {c.category} {Math.round(c.percentage)}%
                    </Text>
                  </View>
                );
              })}
            </View>
          </View>
        )}

        {/* Quick actions */}
        <View style={styles.actionRow}>
          <TouchableOpacity
            style={styles.actionBtn}
            onPress={() => router.push('/(tabs)/scan?mode=manual' as never)}
          >
            <Ionicons name="add-circle-outline" size={20} color={theme.colors.textPrimary} />
            <Text style={styles.actionBtnText}>Add manually</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.actionBtn} onPress={() => router.push('/recurring' as never)}>
            <Ionicons name="repeat-outline" size={20} color={theme.colors.textPrimary} />
            <Text style={styles.actionBtnText}>Recurring</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.actionBtn} onPress={() => router.push('/balances' as never)}>
            <Ionicons name="wallet-outline" size={20} color={theme.colors.textPrimary} />
            <Text style={styles.actionBtnText}>Balances</Text>
          </TouchableOpacity>
        </View>
  
        {/* Budgets */}
        {budgetRows.length > 0 && (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Budgets</Text>
              <TouchableOpacity onPress={() => router.push('/settings?section=budgets' as never)} hitSlop={8}>
                <Text style={styles.sectionLink}>Manage</Text>
              </TouchableOpacity>
            </View>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.budgetScrollContent}
            >
              {budgetRows.map((b) => {
                const meta = statusMeta[b.status];
                const catColor =
                  b.category === RECURRING_BUDGET_KEY
                    ? theme.colors.accent
                    : theme.colors.category[b.category as keyof typeof theme.colors.category];
                const ratio = b.limit > 0 ? Math.min(b.spent / b.limit, 1) : 0;
                return (
                  <View key={b.category} style={styles.budgetChip}>
                    <View style={styles.budgetChipTopRow}>
                      <RingProgress
                        size={30}
                        strokeWidth={4}
                        pct={ratio}
                        // Same independent-of-status-pill red override the
                        // old linear bar had (see the budgetStatus() doc
                        // comment above) — the ring, not just the pill,
                        // should turn error-red past 90%.
                        color={ratio > 0.9 ? theme.colors.error : catColor}
                        trackColor={theme.colors.surfaceHigh}
                        testID="budget-ring"
                      />
                      <View style={[styles.budgetChipStatusPill, { backgroundColor: meta.bg }]}>
                        <Text style={[styles.budgetChipStatusText, { color: meta.color }]}>
                          {meta.label}
                        </Text>
                      </View>
                    </View>
                    <Text style={styles.budgetChipName} numberOfLines={1}>
                      {b.category}
                    </Text>
                    <Text style={styles.budgetChipAmt}>
                      {formatCurrency(b.spent, currency)} of {formatCurrency(b.limit, currency)}
                    </Text>
                  </View>
                );
              })}
            </ScrollView>
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
                      <View style={[styles.avatar, { backgroundColor: `${color}26` }]}>
                        <Text style={styles.avatarText}>
                          {CATEGORY_ICONS[r.category as keyof typeof CATEGORY_ICONS] ?? '🧾'}
                        </Text>
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
