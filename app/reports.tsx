import React, { useCallback, useState } from 'react';
import {
  Alert,
  RefreshControl,
  ScrollView,
  Text,
  View,
} from 'react-native';
import { endOfMonth, format, startOfMonth } from 'date-fns';
import { useFocusEffect } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as FileSystem from 'expo-file-system';
import Svg, { Circle, G } from 'react-native-svg';
// expo-sharing was added in this branch. The existing preview APK
// doesn't have the native side linked, so a top-level import could
// crash the screen on open. Load it lazily inside the export handler
// instead — only paid for when the user actually taps an export action.
import { Theme, useStyles, useTheme } from '../constants/theme';
import { ErrorBoundary } from '../components/ui/ErrorBoundary';
import { EmptyState } from '../components/ui/EmptyState';
import { Skeleton } from '../components/ui/Skeleton';
import { ModalHeader } from '../components/ui/ModalHeader';
import { Button } from '../components/ui/Button';
import { ALL_CATEGORIES } from '../constants/categories';
import { getAllReceipts } from '../lib/database';
import { computeStats } from '../lib/dashboardStats';
import { filterReceiptsInRange, receiptsToCsv } from '../lib/reports';
import { generateReceiptsPdf, isPdfExportAvailable } from '../lib/pdfExport';
import { getCurrency } from '../lib/secureStorage';
import { CurrencyCode, formatCurrency } from '../lib/currency';
import { CategorySummary, MonthlyStats, Receipt, Category } from '../types';

/**
 * Build a human-readable filename for the exported receipt report,
 * e.g. "BalanceSheet Expense Report - July 2026.pdf".
 */
function buildExportFilename(month: Date, ext: 'pdf' | 'csv'): string {
  return `BalanceSheet Expense Report - ${format(month, 'MMMM yyyy')}.${ext}`;
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
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [loading, setLoading] = useState(true);
  const [currency, setCurrency] = useState<CurrencyCode>('USD');

  useFocusEffect(
    useCallback(() => {
      let mounted = true;
      (async () => {
        const [all, code] = await Promise.all([getAllReceipts(), getCurrency()]);
        if (!mounted) return;
        setReceipts(all);
        if (code) setCurrency(code as CurrencyCode);
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

  // Reports screen is scoped to the current calendar month per the
  // design spec — no range picker.
  const now = new Date();
  const monthStart = startOfMonth(now);
  const monthEnd = endOfMonth(now);
  const monthReceipts = filterReceiptsInRange(receipts, monthStart, monthEnd);
  const stats: MonthlyStats = computeStats(monthReceipts);

  // Separate loading flags per button — a single shared `exporting`
  // flag made tapping either button spin BOTH (each button's `loading`
  // prop was bound to the same boolean).
  const [exportingCsv, setExportingCsv] = useState(false);
  const [exportingPdf, setExportingPdf] = useState(false);

  // Lazy-require expo-sharing — the native side wasn't in the
  // original APK before this branch added it, so a top-level
  // import would crash the screen on older builds.
  const shareFile = useCallback(
    async (path: string, mimeType: string, uti: string, dialogTitle: string) => {
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
        await Sharing.shareAsync(path, { mimeType, dialogTitle, UTI: uti });
      } else {
        Alert.alert(
          'Saved',
          `Sharing isn't available in this build, but the file was written to ${path}. Rebuild the app to enable in-app share.`,
        );
      }
    },
    [],
  );

  const exportCsv = useCallback(async () => {
    if (exportingCsv) return;
    if (monthReceipts.length === 0) {
      Alert.alert(
        'Nothing to export',
        'Scan a few receipts before generating a report.',
      );
      return;
    }
    setExportingCsv(true);
    try {
      const csv = receiptsToCsv(monthReceipts, currency);
      const filename = buildExportFilename(monthStart, 'csv');
      const path = `${FileSystem.documentDirectory}${filename}`;
      await FileSystem.writeAsStringAsync(path, csv, {
        encoding: FileSystem.EncodingType.UTF8,
      });
      await shareFile(
        path,
        'text/csv',
        'public.comma-separated-values-text',
        'Export expense report',
      );
    } catch (e) {
      Alert.alert('Export failed', (e as Error)?.message ?? 'Try again.');
    } finally {
      setExportingCsv(false);
    }
  }, [monthReceipts, exportingCsv, monthStart, shareFile]);

  const exportPdf = useCallback(async () => {
    if (exportingPdf) return;
    if (monthReceipts.length === 0) {
      Alert.alert(
        'Nothing to export',
        'Scan a few receipts before generating a report.',
      );
      return;
    }
    // expo-print may not be linked in older/preview APKs — the OTA
    // ships JS only, so we can't assume the native module is loaded
    // until the user installs a fresh build.
    if (!isPdfExportAvailable()) {
      Alert.alert(
        'PDF unavailable',
        'PDF export needs a newer build of the app. Use Export CSV for now, or rebuild to enable PDF.',
      );
      return;
    }
    setExportingPdf(true);
    try {
      const startLabel = format(monthStart, 'PP');
      const endLabel = format(monthEnd, 'PP');
      const filename = buildExportFilename(monthStart, 'pdf');
      const path = await generateReceiptsPdf({
        receipts: monthReceipts,
        startLabel,
        endLabel,
        filename,
        currency,
      });
      if (path) {
        await shareFile(path, 'application/pdf', 'com.adobe.pdf', 'Export expense report');
      }
    } catch (e) {
      Alert.alert('Export failed', (e as Error)?.message ?? 'Try again.');
    } finally {
      setExportingPdf(false);
    }
  }, [monthReceipts, exportingPdf, monthStart, monthEnd, shareFile]);

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <ModalHeader title="Reports" />
      <Text style={styles.subhead}>{format(now, 'MMMM yyyy')}</Text>

      {loading ? (
        <View style={styles.content}>
          <Skeleton width={'100%' as `${number}%`} height={140} borderRadius={theme.radius.lg} />
          <Skeleton width={'100%' as `${number}%`} height={170} borderRadius={theme.radius.lg} />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.content}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={theme.colors.accent}
            />
          }
        >
          {/* Summary — donut chart + total spend this month */}
          <SummaryCard stats={stats} currency={currency} theme={theme} />

          {/* By category — colored dot + name + percentage + amount */}
          {stats.categories.length > 0 && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>BY CATEGORY</Text>
              <View style={styles.sectionBody}>
                {stats.categories.map((c: CategorySummary) => {
                  const standard = (ALL_CATEGORIES as readonly string[]).includes(
                    c.category,
                  );
                  const color = standard
                    ? theme.colors.category[c.category as Category]
                    // NOT theme.colors.primary — dark navy is invisible as a
                    // legend-dot fill against dark mode's card background.
                    : theme.colors.accent;
                  return (
                    <View key={c.category} style={styles.row}>
                      <View style={[styles.categoryDot, { backgroundColor: color }]} />
                      <Text style={styles.rowLabel}>{c.category}</Text>
                      <Text style={styles.rowPct}>{c.percentage.toFixed(0)}%</Text>
                      <Text style={styles.rowAmount}>
                        {formatCurrency(c.total, currency)}
                      </Text>
                    </View>
                  );
                })}
              </View>
            </View>
          )}

          {/* Empty state */}
          {monthReceipts.length === 0 && (
            <EmptyState
              icon="bar-chart-outline"
              title="No data yet"
              description="Scan a few receipts and your monthly summary will appear here."
            />
          )}

          {/* Export — real CSV/PDF generation via lib/reports + lib/pdfExport,
              shared through expo-sharing. Two equal-width outlined buttons
              per the design spec — the only actions on this screen. */}
          <View style={styles.exportRow}>
            <Button
              label="Export CSV"
              variant="secondary"
              onPress={exportCsv}
              loading={exportingCsv}
              disabled={monthReceipts.length === 0}
              style={styles.exportButton}
            />
            <Button
              label="Export PDF"
              variant="secondary"
              onPress={exportPdf}
              loading={exportingPdf}
              disabled={monthReceipts.length === 0}
              style={styles.exportButton}
            />
          </View>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function SummaryCard({
  stats,
  currency,
  theme,
}: {
  stats: MonthlyStats;
  currency: CurrencyCode;
  theme: Theme;
}) {
  const styles = useReportsStyles();
  const count = stats.receiptCount;
  return (
    <View style={styles.summaryCard}>
      <View style={styles.summaryTopRow}>
        <CategoryDonut
          categories={stats.categories}
          total={stats.totalSpent}
          theme={theme}
        />
        <View style={styles.summaryTotalBox}>
          <Text style={styles.summaryAmount}>
            {formatCurrency(stats.totalSpent, currency)}
          </Text>
          <Text style={styles.summarySub}>
            total across {count} expense{count === 1 ? '' : 's'}
          </Text>
        </View>
      </View>
    </View>
  );
}

/**
 * 64px conic-gradient-style donut: one <Circle> per category, drawn as
 * a stroked arc via strokeDasharray/strokeDashoffset, sized to that
 * category's share of the period's total spend. Segment colors come
 * from t.colors.category — the same mapping used by the "BY CATEGORY"
 * row dots below, per the design system's color-semantics rule (never
 * use arbitrary chart colors for category data).
 */
function CategoryDonut({
  categories,
  total,
  theme,
  size = 64,
}: {
  categories: Array<{ category: Category | string; total: number }>;
  total: number;
  theme: Theme;
  size?: number;
}) {
  const strokeWidth = Math.round(size * 0.3);
  const r = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * r;
  const center = size / 2;
  const segments = categories.filter((c) => c.total > 0);

  if (total <= 0 || segments.length === 0) {
    return (
      <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <Circle
          cx={center}
          cy={center}
          r={r}
          stroke={theme.colors.border}
          strokeWidth={strokeWidth}
          fill="none"
        />
      </Svg>
    );
  }

  let offset = 0;
  return (
    <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <G rotation={-90} origin={`${center}, ${center}`}>
        {segments.map((c) => {
          const standard = (ALL_CATEGORIES as readonly string[]).includes(
            c.category as string,
          );
          const color = standard
            ? theme.colors.category[c.category as Category]
            // NOT theme.colors.primary — dark navy would be invisible as a
            // donut-segment stroke against dark mode's card background.
            : theme.colors.accent;
          const frac = c.total / total;
          const dash = Math.max(0, frac * circumference);
          const dashOffset = -offset;
          offset += dash;
          return (
            <Circle
              key={String(c.category)}
              cx={center}
              cy={center}
              r={r}
              stroke={color}
              strokeWidth={strokeWidth}
              strokeDasharray={`${dash} ${circumference - dash}`}
              strokeDashoffset={dashOffset}
              fill="none"
            />
          );
        })}
      </G>
    </Svg>
  );
}

function useReportsStyles() {
  return useStyles((theme) => ({
  root: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  subhead: {
    color: theme.colors.textMuted,
    fontSize: theme.font.sm,
    fontFamily: theme.fonts.body.regular,
    textAlign: 'center',
    paddingTop: theme.spacing.xs,
  },
  content: {
    padding: theme.spacing.md,
    gap: theme.spacing.md,
    paddingBottom: 40,
  },
  summaryCard: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.lg,
    padding: theme.spacing.lg,
    alignItems: 'stretch',
    gap: theme.spacing.sm,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  summaryTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.md,
  },
  summaryTotalBox: {
    flex: 1,
    gap: 2,
  },
  summaryAmount: {
    color: theme.colors.textPrimary,
    fontSize: 26,
    fontFamily: theme.fonts.mono.medium,
  },
  summarySub: {
    color: theme.colors.textMuted,
    fontSize: theme.font.sm,
    fontFamily: theme.fonts.body.regular,
  },
  section: {
    gap: theme.spacing.sm,
  },
  sectionTitle: {
    color: theme.colors.textPrimary,
    fontSize: theme.font.md,
    fontFamily: theme.fonts.display.bold,
  },
  sectionBody: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.md,
    padding: theme.spacing.sm,
    gap: theme.spacing.xs,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 8,
    paddingHorizontal: 4,
  },
  categoryDot: {
    width: 10,
    height: 10,
    borderRadius: theme.radius.full,
  },
  rowLabel: {
    flex: 1,
    color: theme.colors.textPrimary,
    fontSize: theme.font.sm,
    fontFamily: theme.fonts.body.regular,
  },
  rowPct: {
    color: theme.colors.textMuted,
    fontSize: theme.font.xs,
    fontFamily: theme.fonts.mono.regular,
    minWidth: 34,
    textAlign: 'right',
  },
  rowAmount: {
    color: theme.colors.textPrimary,
    fontSize: theme.font.sm,
    fontFamily: theme.fonts.mono.medium,
    minWidth: 72,
    textAlign: 'right',
  },
  exportRow: {
    flexDirection: 'row',
    gap: theme.spacing.sm,
    marginTop: theme.spacing.sm,
  },
  exportButton: {
    flex: 1,
    height: 44,
    borderRadius: theme.radius.lg,
  },
  }));
}
