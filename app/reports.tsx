import React, { useCallback, useState } from 'react';
import {
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Svg, { Circle } from 'react-native-svg';
import {
  endOfMonth,
  format,
  isSameMonth,
  isSameYear,
  startOfMonth,
} from 'date-fns';
import { router, useFocusEffect } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as FileSystem from 'expo-file-system';
// expo-sharing was added in this branch. The existing preview APK
// doesn't have the native side linked, so a top-level import could
// crash the screen on open. Load it lazily inside the export handler
// instead — only paid for when the user actually taps an export button.
import { Theme, useStyles, useTheme } from '../constants/theme';
import { DatePickerModal } from '../components/ui/DatePickerModal';
import { ErrorBoundary } from '../components/ui/ErrorBoundary';
import { EmptyState } from '../components/ui/EmptyState';
import { Skeleton } from '../components/ui/Skeleton';
import { HorizontalBar, VerticalBar } from '../components/ui/AnimatedBar';
import { ModalHeader } from '../components/ui/ModalHeader';
import { Button } from '../components/ui/Button';
import {
  ALL_CATEGORIES,
  CATEGORY_ICONS,
} from '../constants/categories';
import { getAllReceipts } from '../lib/database';
// Custom date range uses a pure-JS calendar modal (no native
// dependency) so it ships via OTA without a new EAS build.
import {
  CategoryTrend,
  MonthBucket,
  PeriodDelta,
  RangeSummary,
  RecurringMatch,
  TopStore,
  categoryTrends,
  filterReceiptsInRange,
  findRecurring,
  monthlyTrend,
  periodOverPeriodDelta,
  receiptsToCsv,
  topStores,
} from '../lib/reports';
import { generateReceiptsPdf, isPdfExportAvailable } from '../lib/pdfExport';
import { Receipt, Category } from '../types';

type PresetKey = 'this' | '2m' | '3m' | '6m' | 'custom';

/** Compute [start, end] for a built-in preset, anchored at TODAY in
 *  local time. "this" = current calendar month; the multi-month
 *  presets stretch backward from today to the start of (N-1) months
 *  ago so the user always sees a complete period including this month. */
function rangeForPreset(preset: Exclude<PresetKey, 'custom'>): {
  start: Date;
  end: Date;
} {
  const now = new Date();
  if (preset === 'this') {
    return {
      start: new Date(now.getFullYear(), now.getMonth(), 1),
      end: new Date(now.getFullYear(), now.getMonth() + 1, 0),
    };
  }
  const monthsBack = preset === '2m' ? 1 : preset === '3m' ? 2 : 5;
  return {
    start: new Date(now.getFullYear(), now.getMonth() - monthsBack, 1),
    end: new Date(now.getFullYear(), now.getMonth() + 1, 0),
  };
}

/**
 * Human-readable label for a date range.
 *
 * Patterns:
 *   • Whole calendar month: "July 2026"
 *   • Custom range in one year: "May 1 - Jun 15, 2026"
 *   • Cross-year range: "Dec 20, 2025 - Jan 5, 2026"
 *
 * Shared by the header subtitle (short period label, e.g. "July
 * 2026") and the export filename builder below.
 */
function periodLabel(start: Date, end: Date): string {
  const isWholeMonth =
    isSameMonth(start, end) &&
    start.getTime() === startOfMonth(start).getTime() &&
    // endOfMonth includes 23:59:59 — compare day numbers so trivial
    // hour/minute drift in the range bounds doesn't break detection.
    end.getDate() === endOfMonth(end).getDate();

  if (isWholeMonth) return format(start, 'MMMM yyyy');
  if (isSameYear(start, end)) {
    return `${format(start, 'MMM d')} - ${format(end, 'MMM d, yyyy')}`;
  }
  return `${format(start, 'MMM d, yyyy')} - ${format(end, 'MMM d, yyyy')}`;
}

/**
 * Build a human-readable filename for the exported receipt report,
 * e.g. "BalanceSheet Expense Report - May 2026.pdf". Spaces and
 * hyphens are fine on iOS/Android filesystems and look clean in the
 * share-sheet preview where the filename is the visible label (Gmail
 * subject, Drive title, etc.). The .pdf / .csv extension is appended
 * by the caller.
 */
function buildExportFilename(start: Date, end: Date, ext: 'pdf' | 'csv'): string {
  return `BalanceSheet Expense Report - ${periodLabel(start, end)}.${ext}`;
}

/** Theme-driven color for a category — standard categories use their
 *  assigned accent, anything custom/tagged falls back to primary. */
function categoryColor(theme: Theme, category: string): string {
  const standard = (ALL_CATEGORIES as readonly string[]).includes(category);
  return standard
    ? theme.colors.category[category as Category]
    : theme.colors.primary;
}

export default function ReportsScreenWrapped() {
  return (
    <ErrorBoundary>
      <ReportsScreen />
    </ErrorBoundary>
  );
}

function ReportsScreen() {
  const theme = useTheme();
  const styles = useReportsStyles();
  const [preset, setPreset] = useState<PresetKey>('this');
  const initial = rangeForPreset('this');
  const [start, setStart] = useState<Date>(initial.start);
  const [end, setEnd] = useState<Date>(initial.end);
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [loading, setLoading] = useState(true);

  const [showStartPicker, setShowStartPicker] = useState(false);
  const [showEndPicker, setShowEndPicker] = useState(false);

  const selectPreset = (key: PresetKey) => {
    setPreset(key);
    if (key !== 'custom') {
      const r = rangeForPreset(key);
      setStart(r.start);
      setEnd(r.end);
    }
  };

  useFocusEffect(
    useCallback(() => {
      let mounted = true;
      (async () => {
        const all = await getAllReceipts();
        if (!mounted) return;
        setReceipts(all);
        setLoading(false);
      })();
      return () => {
        mounted = false;
      };
    }, []),
  );

  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const all = await getAllReceipts();
      setReceipts(all);
    } finally {
      setRefreshing(false);
    }
  }, []);

  // Anchor month for trend chart + category trends: use the END of
  // the selected range so the chart shows the most-recent context.
  const trendYear = end.getFullYear();
  const trendMonth = end.getMonth() + 1;
  // Make the trend window stretch back at least as many months as
  // the user's range — so 6-month preset shows a 6-bar trend, etc.
  const rangeMonthsSpan = Math.max(
    1,
    (end.getFullYear() - start.getFullYear()) * 12 +
      (end.getMonth() - start.getMonth()) +
      1,
  );
  const trendBars = Math.max(6, rangeMonthsSpan);

  const periodDelta: PeriodDelta | null = !loading
    ? periodOverPeriodDelta(receipts, start, end)
    : null;
  const summary: RangeSummary | null = periodDelta?.current ?? null;
  const trend: MonthBucket[] = monthlyTrend(
    receipts,
    trendYear,
    trendMonth,
    trendBars,
  );
  const rangeReceipts = filterReceiptsInRange(receipts, start, end);
  const stores: TopStore[] = topStores(rangeReceipts, 3);
  const trends: CategoryTrend[] = categoryTrends(
    receipts,
    trendYear,
    trendMonth,
    trendBars,
    4,
  );
  const recurring: RecurringMatch[] = findRecurring(receipts, 3);
  const [exporting, setExporting] = useState(false);

  // Explicit CSV/PDF choice from the two export buttons. PDF still
  // falls back to CSV on older builds that pre-date the expo-print
  // native dep — the OTA ships JS only, so we can't assume the
  // native module is loaded until the user installs a fresh APK.
  const exportReport = useCallback(async (kind: 'pdf' | 'csv') => {
    if (exporting) return;
    if (receipts.length === 0) {
      Alert.alert(
        'Nothing to export',
        'Scan a few receipts before generating a report.',
      );
      return;
    }
    setExporting(true);
    try {
      const startLabel = format(start, 'PP');
      const endLabel = format(end, 'PP');

      let path: string | null = null;
      let mimeType = 'application/pdf';
      let uti = 'com.adobe.pdf';
      const dialogTitle = 'Export expense report';

      if (kind === 'pdf') {
        if (isPdfExportAvailable()) {
          const filename = buildExportFilename(start, end, 'pdf');
          path = await generateReceiptsPdf({
            receipts: rangeReceipts,
            startLabel,
            endLabel,
            filename,
          });
        } else {
          Alert.alert(
            'PDF unavailable',
            "PDF export needs a newer build — exporting CSV instead.",
          );
        }
      }

      if (!path) {
        // CSV export (either requested directly, or PDF wasn't
        // available on this build).
        const csv = receiptsToCsv(rangeReceipts);
        const filename = buildExportFilename(start, end, 'csv');
        path = `${FileSystem.documentDirectory}${filename}`;
        await FileSystem.writeAsStringAsync(path, csv, {
          encoding: FileSystem.EncodingType.UTF8,
        });
        mimeType = 'text/csv';
        uti = 'public.comma-separated-values-text';
      }

      // Lazy-require expo-sharing — the native side wasn't in the
      // original APK before this branch added it, so a top-level
      // import would crash the screen on older builds.
      let Sharing: typeof import('expo-sharing') | null = null;
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports, global-require
        Sharing = require('expo-sharing');
      } catch {
        Sharing = null;
      }
      const canShare = Sharing
        ? await Sharing.isAvailableAsync().catch(() => false)
        : false;
      if (Sharing && canShare) {
        await Sharing.shareAsync(path, {
          mimeType,
          dialogTitle,
          UTI: uti,
        });
      } else {
        Alert.alert(
          'Saved',
          `Sharing isn't available in this build, but the file was written to ${path}. Rebuild the app to enable in-app share.`,
        );
      }
    } catch (e) {
      Alert.alert('Export failed', (e as Error)?.message ?? 'Try again.');
    } finally {
      setExporting(false);
    }
  }, [rangeReceipts, exporting, start, end, receipts.length]);

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <ModalHeader title="Reports" />

      {/* Large page title + muted "current period" subtitle, e.g.
          "July 2026" — always visible, independent of loading state. */}
      <View style={styles.pageHeader}>
        <Text style={styles.pageTitle}>Reports</Text>
        <Text style={styles.pageSubtitle}>{periodLabel(start, end)}</Text>
      </View>

      {loading ? (
        <View style={styles.content}>
          {/* Match the eventual layout: range chips strip + hero
              card + trend chart placeholder + sections. */}
          <Skeleton width={'100%' as `${number}%`} height={34} borderRadius={999} />
          <Skeleton width={'100%' as `${number}%`} height={160} borderRadius={16} />
          <Skeleton width={'100%' as `${number}%`} height={170} borderRadius={16} />
          <Skeleton width={'100%' as `${number}%`} height={150} borderRadius={16} />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.content}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={theme.colors.primary}
            />
          }
        >
          {/* Range presets — tap a chip to scope everything below */}
          <View style={styles.presetRow}>
            {(
              [
                { key: 'this' as PresetKey, label: 'This month' },
                { key: '2m' as PresetKey, label: '2 mo' },
                { key: '3m' as PresetKey, label: '3 mo' },
                { key: '6m' as PresetKey, label: '6 mo' },
                { key: 'custom' as PresetKey, label: 'Custom' },
              ] as const
            ).map((p) => {
              const active = preset === p.key;
              return (
                <TouchableOpacity
                  key={p.key}
                  onPress={() => selectPreset(p.key)}
                  style={[styles.presetChip, active && styles.presetChipActive]}
                >
                  <Text
                    style={[
                      styles.presetChipText,
                      active && styles.presetChipTextActive,
                    ]}
                  >
                    {p.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {/* Custom range — two chips that open a calendar modal */}
          {preset === 'custom' && (
            <View style={styles.customRangeRow}>
              <TouchableOpacity
                onPress={() => setShowStartPicker(true)}
                style={styles.dateChip}
              >
                <Ionicons
                  name="calendar-outline"
                  size={14}
                  color={theme.colors.textSecondary}
                />
                <Text style={styles.dateChipText}>
                  {format(start, 'MMM d, yyyy')}
                </Text>
              </TouchableOpacity>
              <Text style={styles.rangeDash}>→</Text>
              <TouchableOpacity
                onPress={() => setShowEndPicker(true)}
                style={styles.dateChip}
              >
                <Ionicons
                  name="calendar-outline"
                  size={14}
                  color={theme.colors.textSecondary}
                />
                <Text style={styles.dateChipText}>
                  {format(end, 'MMM d, yyyy')}
                </Text>
              </TouchableOpacity>
            </View>
          )}

          <DatePickerModal
            visible={showStartPicker}
            initialDate={start}
            maxDate={end}
            title="Start date"
            onClose={() => setShowStartPicker(false)}
            onSelect={(d) => {
              setStart(d);
              setShowStartPicker(false);
            }}
          />
          <DatePickerModal
            visible={showEndPicker}
            initialDate={end}
            minDate={start}
            maxDate={new Date()}
            title="End date"
            onClose={() => setShowEndPicker(false)}
            onSelect={(d) => {
              setEnd(d);
              setShowEndPicker(false);
            }}
          />

          {/* Range label so the user always sees the period in plain English */}
          <Text style={styles.rangeLabel}>
            {format(start, 'MMM d, yyyy')} — {format(end, 'MMM d, yyyy')}
          </Text>

          {/* Hero — donut of category mix + period total + delta */}
          <HeroCard delta={periodDelta} />

          {/* Export triggers — same CSV/PDF logic as before, now two
              explicit buttons instead of one auto-picking share icon. */}
          <View style={styles.exportRow}>
            <Button
              label="EXPORT CSV"
              variant="secondary"
              onPress={() => exportReport('csv')}
              disabled={receipts.length === 0 || exporting}
              loading={exporting}
              style={styles.exportBtn}
            />
            <Button
              label="EXPORT PDF"
              variant="secondary"
              onPress={() => exportReport('pdf')}
              disabled={receipts.length === 0 || exporting}
              loading={exporting}
              style={styles.exportBtn}
            />
          </View>

          {/* Trend chart — bars scale to the range, with the months
              that fall in [start, end] highlighted. Tap a bar to
              switch to that single-month preset. */}
          <Section title={`${trendBars}-month trend`}>
            <TrendChart
              data={trend}
              activeMonthKeys={trend
                .filter((b) => {
                  const bStart = new Date(b.year, b.month - 1, 1);
                  const bEnd = new Date(b.year, b.month, 0, 23, 59, 59);
                  return bStart <= end && bEnd >= start;
                })
                .map((b) => b.key)}
              onBarPress={(b) => {
                setPreset('custom');
                setStart(new Date(b.year, b.month - 1, 1));
                setEnd(new Date(b.year, b.month, 0));
              }}
            />
          </Section>

          {/* By category — dot + name + share of total + amount. Tap
              to drill into the existing category-detail screen
              scoped to the END month of the selected range. (The
              drilldown still keys by month, not arbitrary range, so
              this is the closest match.) */}
          {summary && summary.categories.length > 0 && (
            <Section title="By category">
              {summary.categories.slice(0, 5).map((c) => {
                const color = categoryColor(theme, c.category);
                const pct =
                  summary.total > 0 ? (c.total / summary.total) * 100 : 0;
                return (
                  <Pressable
                    key={c.category}
                    style={({ pressed }) => [
                      styles.categoryRow,
                      pressed && styles.rowPressed,
                    ]}
                    onPress={() => {
                      // Modal-on-modal navigation is buggy in expo-
                      // router. Dismiss this modal, wait for the
                      // animation, then push the next one.
                      const navParams = {
                        category: c.category,
                        year: String(trendYear),
                        month: String(trendMonth),
                      };
                      router.back();
                      setTimeout(() => {
                        router.push({
                          pathname: '/category-detail',
                          params: navParams,
                        } as never);
                      }, 220);
                    }}
                  >
                    <View style={[styles.categoryDot, { backgroundColor: color }]} />
                    <Text style={styles.rowLabel}>{c.category}</Text>
                    <Text style={styles.categoryPct}>{pct.toFixed(0)}%</Text>
                    <Text style={[styles.rowAmount, { color }]}>
                      ${c.total.toFixed(2)}
                    </Text>
                  </Pressable>
                );
              })}
            </Section>
          )}

          {/* Biggest receipt + biggest item */}
          {summary && (summary.biggestReceipt || summary.biggestItem) && (
            <Section title="Standouts">
              {summary.biggestReceipt && (
                <Pressable
                  style={({ pressed }) => [
                    styles.standoutCard,
                    pressed && styles.rowPressed,
                  ]}
                  onPress={() =>
                    router.push(
                      `/edit/${summary.biggestReceipt!.receiptId}` as never,
                    )
                  }
                >
                  <Text style={styles.standoutLabel}>Biggest receipt</Text>
                  <Text style={styles.standoutAmount}>
                    ${summary.biggestReceipt.total.toFixed(2)}
                  </Text>
                  <Text style={styles.standoutSub}>
                    {summary.biggestReceipt.storeName}
                    {' · '}
                    {format(
                      new Date(summary.biggestReceipt.date),
                      'MMM d',
                    )}
                  </Text>
                </Pressable>
              )}
              {summary.biggestItem && (
                <Pressable
                  style={({ pressed }) => [
                    styles.standoutCard,
                    pressed && styles.rowPressed,
                  ]}
                  onPress={() =>
                    router.push(
                      `/edit/${summary.biggestItem!.receiptId}` as never,
                    )
                  }
                >
                  <Text style={styles.standoutLabel}>Biggest single item</Text>
                  <Text style={styles.standoutAmount}>
                    ${summary.biggestItem.amount.toFixed(2)}
                  </Text>
                  <Text style={styles.standoutSub} numberOfLines={1}>
                    {summary.biggestItem.itemName}
                    {' · '}
                    {summary.biggestItem.storeName}
                  </Text>
                </Pressable>
              )}
            </Section>
          )}

          {/* Top stores */}
          {stores.length > 0 && (
            <Section title="Top stores">
              {stores.map((s) => (
                <View key={s.storeName} style={styles.row}>
                  <Ionicons
                    name="storefront-outline"
                    size={16}
                    color={theme.colors.textSecondary}
                  />
                  <Text style={styles.rowLabel}>{s.storeName}</Text>
                  <Text style={styles.rowMuted}>
                    {s.count}x
                  </Text>
                  <Text style={styles.rowAmount}>${s.total.toFixed(2)}</Text>
                </View>
              ))}
            </Section>
          )}

          {/* Per-category trends */}
          {trends.length > 0 && (
            <Section title="Category trends (6 months)">
              {trends.map((t) => {
                const standard = (
                  ALL_CATEGORIES as readonly string[]
                ).includes(t.category);
                const color = categoryColor(theme, t.category);
                const icon = standard
                  ? CATEGORY_ICONS[t.category as Category]
                  : '🏷️';
                const isUp = t.delta > 0;
                const isDown = t.delta < 0;
                return (
                  <View key={t.category} style={styles.trendBlock}>
                    <View style={styles.trendBlockHeader}>
                      <Text style={styles.rowIcon}>{icon}</Text>
                      <Text style={styles.rowLabel}>{t.category}</Text>
                      <View style={styles.trendDelta}>
                        {isUp || isDown ? (
                          <Ionicons
                            name={isUp ? 'arrow-up' : 'arrow-down'}
                            size={11}
                            color={
                              isUp ? theme.colors.error : theme.colors.primary
                            }
                          />
                        ) : null}
                        <Text
                          style={[
                            styles.trendDeltaText,
                            {
                              color: isUp
                                ? theme.colors.error
                                : isDown
                                  ? theme.colors.primary
                                  : theme.colors.textMuted,
                            },
                          ]}
                        >
                          {t.delta === 0
                            ? '—'
                            : `$${Math.abs(t.delta).toFixed(0)}`}
                        </Text>
                      </View>
                      <Text style={[styles.rowAmount, { color }]}>
                        ${t.thisMonth.toFixed(2)}
                      </Text>
                    </View>
                    <CategorySparkline points={t.points} color={color} />
                  </View>
                );
              })}
            </Section>
          )}

          {/* Recurring expenses */}
          {recurring.length > 0 && (
            <Section title="Recurring">
              <Text style={styles.recurringHint}>
                Items and stores that appear in 3+ months — likely
                subscriptions, fuel runs, or staples worth budgeting.
              </Text>
              {recurring.slice(0, 8).map((m) => (
                <View key={`${m.kind}-${m.label}`} style={styles.row}>
                  <Ionicons
                    name={
                      m.kind === 'store'
                        ? 'storefront-outline'
                        : 'cube-outline'
                    }
                    size={16}
                    color={theme.colors.textSecondary}
                  />
                  <View style={styles.recurringLabelBox}>
                    <Text style={styles.rowLabel} numberOfLines={1}>
                      {m.displayName}
                    </Text>
                    <Text style={styles.rowMuted}>
                      {m.monthKeys.length} months · {m.occurrences}x
                    </Text>
                  </View>
                  <Text style={styles.rowAmount}>${m.total.toFixed(2)}</Text>
                </View>
              ))}
            </Section>
          )}

          {/* Empty state */}
          {receipts.length === 0 && (
            <EmptyState
              icon="bar-chart-outline"
              title="No data yet"
              description="Scan a few receipts and your monthly summary, trend chart, top categories, recurring expenses, and standouts will all appear here."
            />
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

/**
 * Hero card: a small category-mix donut on the left, period total +
 * receipt-count caption + period-over-period delta pill on the
 * right. Replaces the old plain "Total spent" summary card.
 */
function HeroCard({ delta }: { delta: PeriodDelta | null }) {
  const theme = useTheme();
  const styles = useReportsStyles();
  if (!delta) return null;
  const { current, delta: d, deltaPct } = delta;
  const isUp = d > 0;
  const isDown = d < 0;
  const deltaColor = isUp
    ? theme.colors.error
    : isDown
      ? theme.colors.primary
      : theme.colors.textMuted;
  const arrow = isUp ? 'arrow-up' : isDown ? 'arrow-down' : 'remove';

  // Donut mirrors the "By category" list below: top 5 categories get
  // their own slice, anything beyond that rolls into a muted "other"
  // slice so the ring still reflects 100% of the period's spend.
  const topCats = current.categories.slice(0, 5);
  const restTotal = current.categories
    .slice(5)
    .reduce((sum, c) => sum + c.total, 0);
  const donutSegments = [
    ...topCats.map((c) => ({
      color: categoryColor(theme, c.category),
      value: c.total,
    })),
    ...(restTotal > 0
      ? [{ color: theme.colors.textMuted, value: restTotal }]
      : []),
  ];

  return (
    <View style={styles.heroCard}>
      <View style={styles.heroLeft}>
        <CategoryDonut segments={donutSegments} />
      </View>
      <View style={styles.heroRight}>
        <Text style={styles.heroAmount}>${current.total.toFixed(2)}</Text>
        <Text style={styles.heroCaption}>
          total across {current.receiptCount} expense
          {current.receiptCount === 1 ? '' : 's'}
        </Text>
        <View style={[styles.deltaPill, { borderColor: deltaColor }]}>
          <Ionicons name={arrow} size={14} color={deltaColor} />
          <Text style={[styles.deltaText, { color: deltaColor }]}>
            {d === 0 && deltaPct == null
              ? 'No data last period'
              : d === 0
                ? 'Same as last period'
                : `$${Math.abs(d).toFixed(2)}${
                    deltaPct != null ? ` (${Math.abs(deltaPct * 100).toFixed(0)}%)` : ''
                  } vs last period`}
          </Text>
        </View>
      </View>
    </View>
  );
}

/**
 * Small ring chart built from react-native-svg (already a project
 * dependency). Each segment is a full-circumference Circle rotated
 * into place with a strokeDasharray covering just its share — the
 * standard SVG "stacked ring" technique, no path math required.
 */
function CategoryDonut({
  segments,
  size = 84,
  strokeWidth = 12,
}: {
  segments: Array<{ color: string; value: number }>;
  size?: number;
  strokeWidth?: number;
}) {
  const theme = useTheme();
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const total = segments.reduce((sum, s) => sum + s.value, 0);
  let cumulativePct = 0;
  return (
    <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <Circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        stroke={theme.colors.border}
        strokeWidth={strokeWidth}
        fill="none"
      />
      {total > 0 &&
        segments.map((seg, idx) => {
          if (seg.value <= 0) return null;
          const pct = seg.value / total;
          const dash = pct * circumference;
          const rotation = -90 + cumulativePct * 360;
          cumulativePct += pct;
          return (
            <Circle
              key={idx}
              cx={size / 2}
              cy={size / 2}
              r={radius}
              stroke={seg.color}
              strokeWidth={strokeWidth}
              strokeDasharray={`${dash} ${circumference - dash}`}
              strokeLinecap="butt"
              fill="none"
              rotation={rotation}
              origin={`${size / 2}, ${size / 2}`}
            />
          );
        })}
    </Svg>
  );
}

function TrendChart({
  data,
  activeMonthKeys,
  onBarPress,
}: {
  data: MonthBucket[];
  activeMonthKeys: string[];
  onBarPress: (bucket: MonthBucket) => void;
}) {
  const theme = useTheme();
  const styles = useReportsStyles();
  const max = Math.max(1, ...data.map((b) => b.total));
  const activeSet = new Set(activeMonthKeys);
  return (
    <View style={styles.trendChart}>
      {data.map((b) => {
        const heightPct = max > 0 ? (b.total / max) * 100 : 0;
        const isActive = activeSet.has(b.key);
        return (
          <Pressable
            key={b.key}
            onPress={() => onBarPress(b)}
            style={({ pressed }) => [
              styles.trendBarCol,
              pressed && { opacity: 0.7 },
            ]}
          >
            <VerticalBar
              percent={heightPct}
              color={isActive ? theme.colors.primary : theme.colors.primaryFaint}
              trackHeight={90}
            />
            <Text style={styles.trendBarLabel}>{b.shortLabel}</Text>
            <Text
              style={[
                styles.trendBarAmount,
                isActive && { color: theme.colors.primary, fontWeight: '700' },
              ]}
              numberOfLines={1}
            >
              ${b.total > 0 ? b.total.toFixed(0) : '—'}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  const styles = useReportsStyles();
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <View style={styles.sectionBody}>{children}</View>
    </View>
  );
}

function CategorySparkline({
  points,
  color,
}: {
  points: Array<{ shortLabel: string; total: number }>;
  color: string;
}) {
  const styles = useReportsStyles();
  const max = Math.max(1, ...points.map((p) => p.total));
  return (
    <View style={styles.sparkRow}>
      {points.map((p, idx) => {
        const h = max > 0 ? (p.total / max) * 100 : 0;
        return (
          <View key={`${p.shortLabel}-${idx}`} style={styles.sparkCol}>
            <VerticalBar percent={h} color={color} trackHeight={26} />
            <Text style={styles.sparkLabel}>{p.shortLabel}</Text>
          </View>
        );
      })}
    </View>
  );
}

function useReportsStyles() {
  return useStyles((theme) => ({
  root: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  pageHeader: {
    paddingHorizontal: theme.spacing.md,
    paddingTop: theme.spacing.md,
    paddingBottom: theme.spacing.xs,
    gap: 2,
  },
  pageTitle: {
    color: theme.colors.textPrimary,
    fontSize: theme.font.xxxl,
    fontWeight: '800',
    letterSpacing: -0.5,
  },
  pageSubtitle: {
    color: theme.colors.textMuted,
    fontSize: theme.font.sm,
    fontWeight: '500',
  },
  content: {
    padding: theme.spacing.md,
    gap: theme.spacing.md,
    paddingBottom: 40,
  },
  presetRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  presetChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: theme.radius.full,
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  presetChipActive: {
    backgroundColor: `${theme.colors.primary}22`,
    borderColor: theme.colors.primary,
  },
  presetChipText: {
    color: theme.colors.textSecondary,
    fontSize: theme.font.xs,
    fontWeight: '700',
  },
  presetChipTextActive: {
    color: theme.colors.primary,
  },
  customRangeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 4,
  },
  dateChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: theme.radius.md,
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  dateChipText: {
    color: theme.colors.textPrimary,
    fontSize: theme.font.sm,
    fontWeight: '600',
  },
  rangeDash: {
    color: theme.colors.textMuted,
    fontSize: theme.font.md,
  },
  rangeLabel: {
    color: theme.colors.textMuted,
    fontSize: theme.font.xs,
    textAlign: 'center',
    marginTop: -4,
  },
  heroCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.lg,
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.lg,
    padding: theme.spacing.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  heroLeft: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroRight: {
    flex: 1,
    gap: 4,
  },
  heroAmount: {
    color: theme.colors.textPrimary,
    fontSize: 36,
    fontWeight: '800',
    letterSpacing: -1,
  },
  heroCaption: {
    color: theme.colors.textMuted,
    fontSize: theme.font.sm,
  },
  deltaPill: {
    marginTop: theme.spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: theme.radius.full,
    borderWidth: 1,
  },
  deltaText: {
    fontSize: theme.font.xs,
    fontWeight: '700',
  },
  exportRow: {
    flexDirection: 'row',
    gap: theme.spacing.sm,
  },
  exportBtn: {
    flex: 1,
  },
  section: {
    gap: theme.spacing.sm,
  },
  sectionTitle: {
    color: theme.colors.textMuted,
    fontSize: theme.font.xs,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  sectionBody: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.lg,
    padding: theme.spacing.sm,
    gap: theme.spacing.xs,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 8,
    paddingHorizontal: 4,
  },
  rowPressed: {
    opacity: 0.6,
  },
  rowIcon: {
    fontSize: 16,
  },
  rowLabel: {
    flex: 1,
    color: theme.colors.textPrimary,
    fontSize: theme.font.sm,
    fontWeight: '500',
  },
  rowMuted: {
    color: theme.colors.textMuted,
    fontSize: theme.font.xs,
  },
  rowAmount: {
    color: theme.colors.textPrimary,
    fontSize: theme.font.sm,
    fontWeight: '700',
    minWidth: 72,
    textAlign: 'right',
  },
  categoryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 9,
    paddingHorizontal: 4,
  },
  categoryDot: {
    width: 10,
    height: 10,
    borderRadius: theme.radius.full,
  },
  categoryPct: {
    color: theme.colors.textMuted,
    fontSize: theme.font.xs,
    minWidth: 34,
    textAlign: 'right',
  },
  standoutCard: {
    backgroundColor: theme.colors.surfaceHigh,
    borderRadius: theme.radius.lg,
    padding: theme.spacing.sm,
    gap: 2,
  },
  standoutLabel: {
    color: theme.colors.textMuted,
    fontSize: theme.font.xs,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  standoutAmount: {
    color: theme.colors.textPrimary,
    fontSize: theme.font.lg,
    fontWeight: '700',
  },
  standoutSub: {
    color: theme.colors.textSecondary,
    fontSize: theme.font.sm,
  },
  trendChart: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: 4,
    height: 140,
  },
  trendBarCol: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'flex-end',
  },
  trendBarTrack: {
    width: '70%',
    height: 90,
    backgroundColor: theme.colors.border,
    borderRadius: theme.radius.sm,
    overflow: 'hidden',
    justifyContent: 'flex-end',
  },
  trendBarFill: {
    width: '100%',
    minHeight: 2,
  },
  trendBarLabel: {
    color: theme.colors.textSecondary,
    fontSize: theme.font.xs,
    marginTop: 4,
    fontWeight: '600',
  },
  trendBarAmount: {
    color: theme.colors.textMuted,
    fontSize: 10,
    marginTop: 1,
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: theme.spacing.xxl,
    gap: theme.spacing.sm,
  },
  emptyTitle: {
    color: theme.colors.textPrimary,
    fontSize: theme.font.lg,
    fontWeight: '700',
    marginTop: theme.spacing.sm,
  },
  emptyText: {
    color: theme.colors.textMuted,
    fontSize: theme.font.sm,
    textAlign: 'center',
    maxWidth: 280,
  },
  trendBlock: {
    paddingVertical: 6,
    paddingHorizontal: 4,
    gap: 6,
  },
  trendBlockHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  trendDelta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    minWidth: 56,
    justifyContent: 'flex-end',
  },
  trendDeltaText: {
    fontSize: theme.font.xs,
    fontWeight: '700',
  },
  sparkRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: 3,
    height: 36,
  },
  sparkCol: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'flex-end',
  },
  sparkBarTrack: {
    width: '70%',
    height: 26,
    backgroundColor: theme.colors.border,
    borderRadius: 2,
    overflow: 'hidden',
    justifyContent: 'flex-end',
  },
  sparkBarFill: {
    width: '100%',
    minHeight: 1,
  },
  sparkLabel: {
    color: theme.colors.textMuted,
    fontSize: 9,
    marginTop: 2,
  },
  recurringHint: {
    color: theme.colors.textMuted,
    fontSize: theme.font.xs,
    paddingHorizontal: 4,
    paddingBottom: 4,
  },
  recurringLabelBox: {
    flex: 1,
    minWidth: 0,
  },
  }));
}
