import React, { useState, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  SectionList,
  ScrollView,
  TextInput,
  TouchableOpacity,
  RefreshControl,
} from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter, useNavigation } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { isToday, isYesterday, format } from 'date-fns';
import { getAllReceipts, deleteReceipt, searchReceipts } from '../../lib/database';
import { Receipt, Category } from '../../types';
import { useStyles, useTheme } from '../../constants/theme';
import { ALL_CATEGORIES, CATEGORY_ICONS } from '../../constants/categories';
import { ReceiptCard } from '../../components/receipt/ReceiptCard';
import { EmptyState } from '../../components/ui/EmptyState';
import { ReceiptListSkeleton } from '../../components/ui/Skeleton';
import { useToast } from '../../components/ui/Toast';
import { notifySuccess, tapMedium } from '../../lib/haptics';
import { receiptMatchesCategory } from '../../lib/receiptFilter';

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
    filterScroll: {
      paddingHorizontal: t.spacing.md,
      paddingBottom: t.spacing.sm,
      gap: 8,
    },
    chip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
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
    chipIcon: {
      fontSize: 12,
    },
    chipLabel: {
      fontFamily: t.fonts.display.bold,
      fontSize: t.font.sm,
      color: t.colors.textSecondary,
    },
    chipLabelActive: {
      color: '#FFFFFF',
    },
    summaryRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      paddingHorizontal: t.spacing.md,
      paddingBottom: t.spacing.sm,
    },
    summaryCount: {
      color: t.colors.textMuted,
      fontFamily: t.fonts.body.regular,
      fontSize: t.font.sm,
    },
    summaryTotal: {
      color: t.colors.primary,
      fontFamily: t.fonts.mono.medium,
      fontSize: t.font.sm,
    },
    listContent: {
      paddingHorizontal: t.spacing.md,
      paddingBottom: 32,
      flexGrow: 1,
    },
    sectionHeader: {
      paddingTop: t.spacing.sm,
      paddingBottom: t.spacing.xs,
      backgroundColor: t.colors.background,
    },
    sectionHeaderText: {
      fontFamily: t.fonts.display.bold,
      fontSize: t.font.md,
      color: t.colors.textSecondary,
    },
  }));
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [query, setQuery] = useState('');
  const [activeFilter, setActiveFilter] = useState<Filter>(FILTER_ALL);
  const params = useLocalSearchParams<{ category?: string }>();
  const toast = useToast();

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
  const isFiltering = query.trim().length > 0 || activeFilter !== FILTER_ALL;
  const sections = groupByDate(filtered);

  return (
    <View style={styles.screen}>
      {/* Header: "Expenses" headline + circular add button (→ manual entry
          via the Scan tab, which exposes "Enter manually (no receipt)"). */}
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

      {/* Category filter chips — single horizontal-scrolling row per the
          design spec. Active = dark-navy fill/white text; inactive =
          outlined. */}
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
              {item !== FILTER_ALL && (
                <Text style={styles.chipIcon}>
                  {CATEGORY_ICONS[item as Category]}
                </Text>
              )}
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

      {/* Receipt list — grouped by date label ("Today", "Yesterday", "Jul
          27", …). Shows skeleton placeholders during the first load so the
          user sees the expected layout instead of the empty state flashing
          for a fraction of a second. */}
      {initialLoading ? (
        <View style={styles.listContent}>
          <ReceiptListSkeleton count={5} />
        </View>
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <ReceiptCard receipt={item} onDelete={handleDelete} />
          )}
          renderSectionHeader={({ section }) => (
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionHeaderText}>{section.title}</Text>
            </View>
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
            isFiltering ? (
              <EmptyState icon="search-outline" title="No expenses match." />
            ) : (
              <EmptyState
                icon="receipt-outline"
                title="No expenses yet"
                description="Scan your first receipt with the camera tab and it'll show up here, grouped by category and date."
              />
            )
          }
        />
      )}
    </View>
  );
}
