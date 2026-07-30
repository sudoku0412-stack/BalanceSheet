import React, { useState, useCallback, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  ScrollView,
  TextInput,
  TouchableOpacity,
  RefreshControl,
} from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter, useNavigation } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { isToday, isYesterday, format } from 'date-fns';
import { getAllReceipts, searchReceipts } from '../../lib/database';
import { Receipt, Category } from '../../types';
import { useStyles, useTheme } from '../../constants/theme';
import { ALL_CATEGORIES } from '../../constants/categories';
import { EmptyState } from '../../components/ui/EmptyState';
import { ReceiptListSkeleton } from '../../components/ui/Skeleton';
import { receiptMatchesCategory } from '../../lib/receiptFilter';
import { findRecurring } from '../../lib/reports';

const FILTER_ALL = 'All' as const;
type Filter = typeof FILTER_ALL | Category;

/** "Today" / "Yesterday" / "Jul 27" — the date-group label used to
 *  section the expense list, per the design spec's grouped-list layout. */
function dateGroupLabel(dateStr: string): string {
  const d = new Date(dateStr);
  if (isToday(d)) return 'Today';
  if (isYesterday(d)) return 'Yesterday';
  return format(d, 'MMM d');
}

/** Groups an already date-sorted (DESC) receipt list into consecutive
 *  { title, data } sections keyed by date-group label. */
function groupByDate(items: Receipt[]): { title: string; data: Receipt[] }[] {
  const sections: { title: string; data: Receipt[] }[] = [];
  for (const receipt of items) {
    const label = dateGroupLabel(receipt.date);
    const current = sections[sections.length - 1];
    if (current && current.title === label) {
      current.data.push(receipt);
    } else {
      sections.push({ title: label, data: [receipt] });
    }
  }
  return sections;
}

export default function HistoryScreen() {
  const theme = useTheme();
  const router = useRouter();
  const navigation = useNavigation();
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
      paddingTop: t.spacing.md,
      paddingBottom: t.spacing.sm,
    },
    headerTitle: {
      fontFamily: t.fonts.display.extraBold,
      fontSize: t.font.xxl,
      color: t.colors.textPrimary,
    },
    addButton: {
      width: 36,
      height: 36,
      borderRadius: t.radius.full,
      backgroundColor: t.colors.primary,
      alignItems: 'center',
      justifyContent: 'center',
    },
    searchContainer: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      height: 40,
      marginHorizontal: t.spacing.md,
      marginBottom: t.spacing.sm,
      paddingHorizontal: 12,
      backgroundColor: t.colors.surface,
      borderRadius: t.radius.lg,
      borderWidth: 1,
      borderColor: t.colors.border,
    },
    searchInput: {
      flex: 1,
      color: t.colors.textPrimary,
      fontFamily: t.fonts.body.regular,
      fontSize: t.font.md,
    },
    filterScrollContainer: {
      flexGrow: 0,
      height: 44,
      marginBottom: t.spacing.sm,
    },
    filterScroll: {
      paddingHorizontal: t.spacing.md,
      alignItems: 'center',
      gap: 8,
    },
    chip: {
      paddingHorizontal: 12,
      paddingVertical: 6,
      borderRadius: t.radius.full,
      backgroundColor: 'transparent',
      borderWidth: 1,
      borderColor: t.colors.border,
    },
    chipActive: {
      backgroundColor: t.colors.primary,
      borderColor: t.colors.primary,
    },
    chipLabel: {
      fontFamily: t.fonts.display.bold,
      fontSize: t.font.sm,
      lineHeight: t.font.sm + 4,
      color: t.colors.textPrimary,
    },
    chipLabelActive: {
      color: '#FFFFFF',
    },
    listContent: {
      paddingHorizontal: t.spacing.md,
      paddingBottom: 32,
      flexGrow: 1,
    },
    sectionHeaderText: {
      fontFamily: t.fonts.display.bold,
      fontSize: t.font.md,
      color: t.colors.textSecondary,
      paddingTop: t.spacing.sm,
      paddingBottom: t.spacing.xs,
    },
    card: {
      backgroundColor: t.colors.surface,
      borderRadius: t.radius.lg,
      borderWidth: 1,
      borderColor: t.colors.border,
      overflow: 'hidden',
      marginBottom: t.spacing.sm,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: t.spacing.sm,
      padding: t.spacing.md,
    },
    rowDivider: {
      borderBottomWidth: 1,
      borderBottomColor: t.colors.border,
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
      color: '#FFFFFF',
    },
    rowInfo: {
      flex: 1,
      gap: 2,
    },
    rowStoreName: {
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
      flexShrink: 0,
      paddingLeft: t.spacing.sm,
    },
  }));
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [query, setQuery] = useState('');
  const [activeFilter, setActiveFilter] = useState<Filter>(FILTER_ALL);
  const params = useLocalSearchParams<{ category?: string }>();

  // This screen renders its own "Expenses" headline + add button per the
  // design spec, so the default per-tab native header ("History") is
  // suppressed here rather than in the shared tab layout.
  useEffect(() => {
    navigation.setOptions({ headerShown: false });
  }, [navigation]);

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

  const isFiltering = query.trim().length > 0 || activeFilter !== FILTER_ALL;
  const sections = groupByDate(filtered);

  // Real recurring-charge detection (lib/reports.findRecurring) run against
  // the full receipt set, independent of the active search/filter — a
  // merchant either is or isn't a detected recurring charge regardless of
  // what's currently on screen. Only store-level matches map to a single
  // merchant name, which is what a list row can show.
  const recurringStores = useMemo(() => {
    const matches = findRecurring(receipts);
    return new Set(
      matches.filter((m) => m.kind === 'store').map((m) => m.label),
    );
  }, [receipts]);

  return (
    <View style={styles.screen}>
      {/* Header: "Expenses" headline + circular add button (→ manual entry
          via the Scan tab, same target as Home's "+ Add manually"). */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Expenses</Text>
        <TouchableOpacity
          style={styles.addButton}
          onPress={() => router.push('/(tabs)/scan')}
          accessibilityRole="button"
          accessibilityLabel="Add expense"
        >
          <Ionicons name="add" size={22} color="#FFFFFF" />
        </TouchableOpacity>
      </View>

      {/* Search bar */}
      <View style={styles.searchContainer}>
        <Ionicons name="search-outline" size={18} color={theme.colors.accent} />
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

      {/* Category filter chips — single horizontal-scrolling row. Active =
          dark-navy fill/white text; inactive = outlined. Tapping only
          filters the list in place, never navigates. */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.filterScrollContainer}
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

      {/* Expense list — grouped by date label ("Today", "Yesterday", "Jul
          27", …), each group a bordered card of rows. Shows skeleton
          placeholders during the first load. */}
      {initialLoading ? (
        <View style={styles.listContent}>
          <ReceiptListSkeleton count={5} />
        </View>
      ) : sections.length === 0 ? (
        <View style={styles.listContent}>
          {isFiltering ? (
            <EmptyState icon="search-outline" title="No expenses match." />
          ) : (
            <EmptyState
              icon="receipt-outline"
              title="No expenses yet"
              description="Scan your first receipt with the camera tab and it'll show up here, grouped by category and date."
            />
          )}
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={theme.colors.primary}
            />
          }
        >
          {sections.map((section) => (
            <View key={section.title}>
              <Text style={styles.sectionHeaderText}>{section.title}</Text>
              <View style={styles.card}>
                {section.data.map((r, idx) => {
                  const isRecurring = recurringStores.has(
                    r.storeName.trim().toLowerCase(),
                  );
                  return (
                    <TouchableOpacity
                      key={r.id}
                      activeOpacity={0.8}
                      onPress={() => router.push(`/edit/${r.id}`)}
                      style={[
                        styles.row,
                        idx < section.data.length - 1 && styles.rowDivider,
                      ]}
                    >
                      <View
                        style={[
                          styles.avatar,
                          { backgroundColor: theme.colors.category[r.category] },
                        ]}
                      >
                        <Text style={styles.avatarText}>
                          {r.storeName.charAt(0).toUpperCase()}
                        </Text>
                      </View>
                      <View style={styles.rowInfo}>
                        <Text style={styles.rowStoreName} numberOfLines={1}>
                          {r.storeName}
                        </Text>
                        <Text style={styles.rowMeta}>
                          {r.category}
                          {isRecurring ? ' · Recurring' : ''}
                        </Text>
                      </View>
                      <Text style={styles.rowAmount}>
                        ${r.totalAmount.toFixed(2)}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>
          ))}
        </ScrollView>
      )}
    </View>
  );
}
