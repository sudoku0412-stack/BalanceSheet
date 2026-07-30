import React, { useState, useCallback, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  SectionList,
  ScrollView,
  TextInput,
  TouchableOpacity,
  RefreshControl,
} from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { format, isToday, isYesterday } from 'date-fns';
import { getAllReceipts, deleteReceipt, searchReceipts } from '../../lib/database';
import { Receipt, Category } from '../../types';
import { useStyles, useTheme } from '../../constants/theme';
import { ALL_CATEGORIES } from '../../constants/categories';
import { EmptyState } from '../../components/ui/EmptyState';
import { ReceiptListSkeleton } from '../../components/ui/Skeleton';
import { useToast } from '../../components/ui/Toast';
import { tapMedium } from '../../lib/haptics';
import { receiptMatchesCategory } from '../../lib/receiptFilter';

const FILTER_ALL = 'All' as const;
type Filter = typeof FILTER_ALL | Category;

/** "Today" / "Yesterday" / "Jul 27" — used for both the row's secondary
 *  line and (uppercased) the section header above each day's group. */
function relativeLabel(date: Date): string {
  if (isToday(date)) return 'Today';
  if (isYesterday(date)) return 'Yesterday';
  return format(date, 'MMM d');
}

/** Groups receipts (already date-DESC sorted by the DB query) into
 *  contiguous day sections for the SectionList. */
function groupByDay(receipts: Receipt[]): { title: string; data: Receipt[] }[] {
  const order: string[] = [];
  const map = new Map<string, Receipt[]>();
  for (const r of receipts) {
    const title = relativeLabel(new Date(r.date)).toUpperCase();
    if (!map.has(title)) {
      map.set(title, []);
      order.push(title);
    }
    map.get(title)!.push(r);
  }
  return order.map((title) => ({ title, data: map.get(title)! }));
}

export default function HistoryScreen() {
  const theme = useTheme();
  const router = useRouter();
  const styles = useStyles((t) => ({
    screen: {
      flex: 1,
      backgroundColor: t.colors.background,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: t.spacing.md,
      paddingTop: t.spacing.sm,
      paddingBottom: t.spacing.xs,
    },
    title: {
      color: t.colors.textPrimary,
      fontSize: t.font.xxxl,
      fontWeight: '800',
    },
    addButton: {
      width: 36,
      height: 36,
      borderRadius: t.radius.full,
      backgroundColor: t.colors.surfaceHigh,
      alignItems: 'center',
      justifyContent: 'center',
    },
    searchContainer: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      marginHorizontal: t.spacing.md,
      marginTop: t.spacing.sm,
      marginBottom: t.spacing.md,
      paddingHorizontal: 12,
      paddingVertical: 10,
      backgroundColor: t.colors.surface,
      borderRadius: t.radius.lg,
      borderWidth: 1,
      borderColor: t.colors.border,
    },
    searchInput: {
      flex: 1,
      color: t.colors.textPrimary,
      fontSize: t.font.md,
    },
    filterScroll: {
      paddingHorizontal: t.spacing.md,
      paddingBottom: t.spacing.md,
      gap: 8,
    },
    chip: {
      paddingHorizontal: 14,
      paddingVertical: 8,
      borderRadius: t.radius.full,
      backgroundColor: t.colors.surface,
      borderWidth: 1,
      borderColor: t.colors.border,
      marginRight: 8,
    },
    chipActive: {
      backgroundColor: t.colors.primary,
      borderColor: t.colors.primary,
    },
    chipLabel: {
      color: t.colors.textSecondary,
      fontSize: t.font.sm,
      fontWeight: '600',
    },
    chipLabelActive: {
      color: t.colors.textPrimary,
      fontWeight: '700',
    },
    summaryRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      paddingHorizontal: t.spacing.md,
      paddingBottom: t.spacing.sm,
    },
    summaryCount: {
      color: t.colors.textMuted,
      fontSize: t.font.sm,
    },
    summaryTotal: {
      color: t.colors.primary,
      fontSize: t.font.sm,
      fontWeight: '700',
    },
    listContent: {
      paddingHorizontal: t.spacing.md,
      paddingBottom: 32,
    },
    sectionHeader: {
      color: t.colors.textMuted,
      fontSize: t.font.xs,
      fontWeight: '700',
      letterSpacing: 0.6,
      textTransform: 'uppercase',
      paddingTop: t.spacing.md,
      paddingBottom: t.spacing.sm,
      backgroundColor: t.colors.background,
    },
  }));
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [query, setQuery] = useState('');
  const [activeFilter, setActiveFilter] = useState<Filter>(FILTER_ALL);
  const params = useLocalSearchParams<{ category?: string }>();
  const toast = useToast();

  // When the dashboard navigates here with `?category=X`, pre-select X
  // as the filter. Re-fires whenever a fresh navigation arrives.
  useEffect(() => {
    if (
      params.category &&
      (ALL_CATEGORIES as readonly string[]).includes(params.category)
    ) {
      setActiveFilter(params.category as Category);
    }
  }, [params.category]);

  const [refreshing, setRefreshing] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);

  const load = useCallback(async () => {
    const data = await getAllReceipts();
    setReceipts(data);
  }, []);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      if (query.trim()) {
        const results = await searchReceipts(query.trim());
        setReceipts(results);
      } else {
        await load();
      }
    } finally {
      setRefreshing(false);
    }
  }, [query, load]);

  useFocusEffect(
    useCallback(() => {
      (async () => {
        await load();
        setInitialLoading(false);
      })();
    }, [load]),
  );

  const handleSearch = async (text: string) => {
    setQuery(text);
    if (text.trim().length > 0) {
      const results = await searchReceipts(text.trim());
      setReceipts(results);
    } else {
      await load();
    }
  };

  const handleDelete = (id: string) => {
    const target = receipts.find((r) => r.id === id);
    if (!target) return;
    tapMedium();
    // Optimistically remove from the list so the user sees instant
    // feedback. Defer the actual DB delete by 5 seconds so they can
    // tap Undo on the toast before it lands.
    setReceipts((prev) => prev.filter((r) => r.id !== id));
    const timer = setTimeout(() => {
      deleteReceipt(id).catch(() => {
        // If the eventual delete failed, refetch so the UI matches
        // reality.
        load();
      });
    }, 5000);
    toast.show({
      message: `Deleted ${target.storeName}`,
      kind: 'success',
      undoLabel: 'Undo',
      onUndo: () => {
        clearTimeout(timer);
        load(); // restore from DB (it was never actually deleted)
      },
      durationMs: 5000,
    });
  };

  // A receipt matches the active filter when EITHER:
  //   - its primary `category` equals the filter, OR
  //   - any of its categoryTags equals the filter, OR
  //   - any of its line items has that category
  // This way a Walmart receipt with a Healthcare item shows up under the
  // Healthcare filter even though the primary category is Groceries.
  const filtered =
    activeFilter === FILTER_ALL
      ? receipts
      : receipts.filter((r) => receiptMatchesCategory(r, activeFilter));

  const totalFiltered = filtered.reduce((s, r) => s + r.totalAmount, 0);
  const sections = useMemo(() => groupByDay(filtered), [filtered]);

  const goToAdd = () => router.push('/(tabs)/scan');

  return (
    <View style={styles.screen}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.title}>Expenses</Text>
        <TouchableOpacity
          style={styles.addButton}
          onPress={goToAdd}
          accessibilityRole="button"
          accessibilityLabel="Add receipt"
        >
          <Ionicons name="add" size={20} color={theme.colors.textPrimary} />
        </TouchableOpacity>
      </View>

      {/* Search bar */}
      <View style={styles.searchContainer}>
        <Ionicons name="search-outline" size={18} color={theme.colors.textMuted} />
        <TextInput
          style={styles.searchInput}
          value={query}
          onChangeText={handleSearch}
          placeholder="Search merchant"
          placeholderTextColor={theme.colors.textMuted}
          returnKeyType="search"
          clearButtonMode="while-editing"
        />
        {query.length > 0 && (
          <TouchableOpacity onPress={() => handleSearch('')}>
            <Ionicons name="close-circle" size={18} color={theme.colors.textMuted} />
          </TouchableOpacity>
        )}
      </View>

      {/* Category filter chips — horizontal scrollable pill row. */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.filterScroll}
      >
        {([FILTER_ALL, ...ALL_CATEGORIES] as Filter[]).map((item) => {
          const active = activeFilter === item;
          return (
            <TouchableOpacity
              key={item}
              onPress={() => setActiveFilter(item)}
              style={[styles.chip, active && styles.chipActive]}
            >
              <Text style={[styles.chipLabel, active && styles.chipLabelActive]}>
                {item}
              </Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      {/* Summary row */}
      {filtered.length > 0 && (
        <View style={styles.summaryRow}>
          <Text style={styles.summaryCount}>{filtered.length} receipt{filtered.length !== 1 ? 's' : ''}</Text>
          <Text style={styles.summaryTotal}>${totalFiltered.toFixed(2)} total</Text>
        </View>
      )}

      {/* Receipt list — show skeleton placeholders during the first
          load so the user sees the expected layout instead of the
          empty state flashing for a fraction of a second. */}
      {initialLoading ? (
        <View style={styles.listContent}>
          <ReceiptListSkeleton count={5} />
        </View>
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(item) => item.id}
          renderSectionHeader={({ section }) => (
            <Text style={styles.sectionHeader}>{section.title}</Text>
          )}
          renderItem={({ item }) => (
            <ExpenseRow receipt={item} onDelete={handleDelete} />
          )}
          contentContainerStyle={styles.listContent}
          ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
          stickySectionHeadersEnabled={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={theme.colors.primary}
            />
          }
          ListEmptyComponent={
            query ? (
              <EmptyState
                icon="search-outline"
                title="No receipts found"
                description={`No receipts match "${query}". Try a different search term or clear the search to see everything.`}
              />
            ) : (
              <EmptyState
                icon="receipt-outline"
                title="No receipts yet"
                description="Scan your first receipt with the camera tab and it'll show up here, grouped by category and date."
              />
            )
          }
        />
      )}
    </View>
  );
}

/**
 * A single expense row: letter-avatar tinted by category (reusing
 * ReceiptCard's deterministic category-tint + first-letter approach),
 * merchant name, a "Category · relative date" secondary line, and a
 * right-aligned bold amount. Tapping navigates to the edit/detail
 * screen; the trash icon fires the same delete-with-undo flow as
 * before.
 */
function ExpenseRow({
  receipt,
  onDelete,
}: {
  receipt: Receipt;
  onDelete: (id: string) => void;
}) {
  const theme = useTheme();
  const router = useRouter();
  const styles = useStyles((t) => ({
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
      width: 44,
      height: 44,
      borderRadius: t.radius.full,
      alignItems: 'center',
      justifyContent: 'center',
      flexShrink: 0,
    },
    avatarLetter: {
      fontSize: t.font.lg,
      fontWeight: '700',
      color: t.colors.textPrimary,
    },
    rowInfo: {
      flex: 1,
      gap: 2,
    },
    merchantName: {
      color: t.colors.textPrimary,
      fontSize: t.font.md,
      fontWeight: '700',
    },
    subLine: {
      color: t.colors.textSecondary,
      fontSize: t.font.xs,
    },
    rowRight: {
      alignItems: 'flex-end',
      gap: 6,
      flexShrink: 0,
      paddingLeft: t.spacing.sm,
    },
    amount: {
      color: t.colors.textPrimary,
      fontSize: t.font.lg,
      fontWeight: '700',
      fontVariant: ['tabular-nums'],
    },
  }));

  const tint = theme.colors.category[receipt.category];
  const sub = `${receipt.category} · ${relativeLabel(new Date(receipt.date))}`;

  return (
    <TouchableOpacity
      activeOpacity={0.8}
      onPress={() => router.push(`/edit/${receipt.id}`)}
      style={styles.row}
    >
      <View style={styles.rowLeft}>
        <View style={[styles.avatar, { backgroundColor: `${tint}22` }]}>
          <Text style={styles.avatarLetter}>
            {receipt.storeName.charAt(0).toUpperCase()}
          </Text>
        </View>
        <View style={styles.rowInfo}>
          <Text style={styles.merchantName} numberOfLines={1}>
            {receipt.storeName}
          </Text>
          <Text style={styles.subLine} numberOfLines={1}>
            {sub}
          </Text>
        </View>
      </View>

      <View style={styles.rowRight}>
        <Text style={styles.amount}>${receipt.totalAmount.toFixed(2)}</Text>
        <TouchableOpacity
          onPress={() => onDelete(receipt.id)}
          hitSlop={{ top: 14, bottom: 14, left: 14, right: 14 }}
          accessibilityRole="button"
          accessibilityLabel="Delete receipt"
        >
          <Ionicons name="trash-outline" size={16} color={theme.colors.textMuted} />
        </TouchableOpacity>
      </View>
    </TouchableOpacity>
  );
}
