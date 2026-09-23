import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import {
  ActivityIndicator,
  Alert,
  View,
  Text,
  ScrollView,
  TextInput,
  TouchableOpacity,
  RefreshControl,
} from 'react-native';
import { Swipeable } from 'react-native-gesture-handler';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useLocalSearchParams, useRouter, useNavigation } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { isToday, isYesterday, format } from 'date-fns';
import {
  deleteIncome,
  deleteReceipt,
  getAllIncomes,
  getAllReceipts,
  getCurrentHouseholdId,
  searchIncomes,
  searchReceipts,
} from '../../lib/database';
import { getCurrency } from '../../lib/secureStorage';
import { formatCurrency, CurrencyCode } from '../../lib/currency';
import { Income, Receipt, Category } from '../../types';
import { useStyles, useTheme } from '../../constants/theme';
import { ALL_CATEGORIES, CATEGORY_ICONS } from '../../constants/categories';
import { INCOME_CATEGORY_ICONS, incomeCategoryLabel } from '../../constants/incomeCategories';
import { EmptyState } from '../../components/ui/EmptyState';
import { ReceiptListSkeleton } from '../../components/ui/Skeleton';
import { useToast } from '../../components/ui/Toast';
import { receiptMatchesCategory } from '../../lib/receiptFilter';
import { findRecurring } from '../../lib/reports';
import { onLocalDataChanged } from '../../lib/dataSync';
import { getHouseholdMembers, HouseholdMember } from '../../lib/cloudSync';
import { useAuth } from '../../lib/AuthContext';

const FILTER_ALL = 'All' as const;
type CategoryFilter = typeof FILTER_ALL | Category;
type KindFilter = 'all' | 'income' | 'expenses';

type FeedItem =
  | { kind: 'expense'; id: string; date: string; receipt: Receipt }
  | { kind: 'income'; id: string; date: string; income: Income };

/** "Today" / "Yesterday" / "Jul 27" — the date-group label used to
 *  section the expense list, per the design spec's grouped-list layout. */
function dateGroupLabel(dateStr: string): string {
  const d = new Date(dateStr);
  if (isToday(d)) return 'Today';
  if (isYesterday(d)) return 'Yesterday';
  return format(d, 'MMM d');
}

/** Groups an already date-sorted (DESC) feed into consecutive
 *  { title, data } sections keyed by date-group label. */
function groupByDate(items: FeedItem[]): { title: string; data: FeedItem[] }[] {
  const sections: { title: string; data: FeedItem[] }[] = [];
  for (const item of items) {
    const label = dateGroupLabel(item.date);
    const current = sections[sections.length - 1];
    if (current && current.title === label) {
      current.data.push(item);
    } else {
      sections.push({ title: label, data: [item] });
    }
  }
  return sections;
}

function truncateUid(uid: string): string {
  return uid.length > 8 ? `${uid.slice(0, 6)}…` : uid;
}

function memberDisplayName(
  uid: string,
  members: HouseholdMember[],
  currentUid: string | undefined,
): string {
  if (currentUid && uid === currentUid) return 'You';
  const m = members.find((x) => x.uid === uid);
  if (m?.isYou) return 'You';
  return m?.displayName?.trim() || m?.email?.trim() || truncateUid(uid);
}

export default function HistoryScreen() {
  const theme = useTheme();
  const router = useRouter();
  const toast = useToast();
  const navigation = useNavigation();
  const { user } = useAuth();
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
      // Dark-navy fill blends into the dark-mode page; a light-toned
      // border in dark mode keeps the circle readable as a button.
      borderWidth: t.isDark ? 1 : 0,
      borderColor: t.isDark ? t.colors.borderLight : 'transparent',
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
      borderRadius: 16,
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
      backgroundColor: t.colors.success,
      // In dark mode, override the border so the chip's shape stays
      // visible against the dark-mode page instead of blending in.
      borderColor: t.isDark ? t.colors.borderLight : t.colors.success,
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
      paddingBottom: 100,
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
      borderRadius: 20,
      overflow: 'hidden',
      marginBottom: t.spacing.sm,
      shadowColor: t.isDark ? '#000' : '#0C0F24',
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: t.isDark ? 0.4 : 0.08,
      shadowRadius: 10,
      elevation: 2,
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
    rowAmountIncome: {
      fontFamily: t.fonts.mono.medium,
      fontSize: t.font.md,
      color: t.colors.success,
      flexShrink: 0,
      paddingLeft: t.spacing.sm,
    },
    deleteAction: {
      backgroundColor: t.colors.error,
      justifyContent: 'center',
      alignItems: 'center',
      width: 84,
      gap: 2,
    },
    deleteActionText: {
      color: '#fff',
      fontFamily: t.fonts.display.bold,
      fontSize: t.font.xs,
    },
  }));
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [incomes, setIncomes] = useState<Income[]>([]);
  const [members, setMembers] = useState<HouseholdMember[]>([]);
  const [query, setQuery] = useState('');
  const [kindFilter, setKindFilter] = useState<KindFilter>('all');
  const [activeFilter, setActiveFilter] = useState<CategoryFilter>(FILTER_ALL);
  const [currency, setCurrency] = useState<CurrencyCode>('USD');
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const swipeableRefs = useRef<Record<string, Swipeable | null>>({});
  const params = useLocalSearchParams<{ category?: string }>();

  // This screen renders its own "Activity" headline + add button per the
  // design spec, so the default per-tab native header ("History") is
  // suppressed here rather than in the shared tab layout.
  useEffect(() => {
    navigation.setOptions({ headerShown: false });
  }, [navigation]);

  // When the dashboard navigates here with `?category=X`, pre-select X
  // as the filter and switch to expenses so category chips apply.
  useEffect(() => {
    if (
      params.category &&
      (ALL_CATEGORIES as readonly string[]).includes(params.category)
    ) {
      setKindFilter('expenses');
      setActiveFilter(params.category as Category);
    }
  }, [params.category]);

  const [refreshing, setRefreshing] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);

  const loadMembers = useCallback(async () => {
    const hid = getCurrentHouseholdId();
    if (!hid || !user?.uid) {
      setMembers([]);
      return;
    }
    const list = await getHouseholdMembers({ householdId: hid, currentUid: user.uid });
    setMembers(list ?? []);
  }, [user?.uid]);

  const load = useCallback(async () => {
    const [receiptData, incomeData, currencyCode] = await Promise.all([
      getAllReceipts(),
      getAllIncomes(),
      getCurrency(),
    ]);
    setReceipts(receiptData);
    setIncomes(incomeData);
    setCurrency((currencyCode as CurrencyCode | null) ?? 'USD');
    await loadMembers();
  }, [loadMembers]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      if (query.trim()) {
        const [receiptResults, incomeResults] = await Promise.all([
          searchReceipts(query.trim()),
          searchIncomes(query.trim()),
        ]);
        setReceipts(receiptResults);
        setIncomes(incomeResults);
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

  useEffect(() => onLocalDataChanged(() => load()), [load]);

  const handleSearch = async (text: string) => {
    setQuery(text);
    if (text.trim().length > 0) {
      const [receiptResults, incomeResults] = await Promise.all([
        searchReceipts(text.trim()),
        searchIncomes(text.trim()),
      ]);
      setReceipts(receiptResults);
      setIncomes(incomeResults);
    } else {
      await load();
    }
  };

  // Re-fetches whatever's currently on screen (a search result set or
  // the full list) after a swipe-to-delete, same as onRefresh/handleSearch.
  const refreshAfterDelete = useCallback(async () => {
    if (query.trim()) {
      const [receiptResults, incomeResults] = await Promise.all([
        searchReceipts(query.trim()),
        searchIncomes(query.trim()),
      ]);
      setReceipts(receiptResults);
      setIncomes(incomeResults);
    } else {
      await load();
    }
  }, [query, load]);

  const showAddSheet = () => {
    Alert.alert('Add', undefined, [
      {
        text: 'Add expense',
        onPress: () => router.push('/(tabs)/scan?mode=manual'),
      },
      {
        text: 'Add income',
        onPress: () => router.push('/add-income' as never),
      },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  // Swipe-to-delete for an expense row, mirroring households.tsx's
  // Swipeable delete pattern: swipe left to reveal a Delete action,
  // confirm via Alert, then delete and refresh the list.
  const confirmDeleteReceipt = (receipt: Receipt) => {
    swipeableRefs.current[`expense:${receipt.id}`]?.close();
    Alert.alert('Delete Receipt', 'This action cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => performDeleteReceipt(receipt.id),
      },
    ]);
  };

  const performDeleteReceipt = async (id: string) => {
    if (deletingId) return;
    setDeletingId(`expense:${id}`);
    try {
      await deleteReceipt(id);
      await refreshAfterDelete();
    } catch (e) {
      toast.show({ kind: 'error', message: (e as Error)?.message ?? "Couldn't delete that receipt." });
    } finally {
      setDeletingId(null);
    }
  };

  const confirmDeleteIncome = (income: Income) => {
    swipeableRefs.current[`income:${income.id}`]?.close();
    Alert.alert('Delete income', 'This action cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => performDeleteIncome(income.id),
      },
    ]);
  };

  const performDeleteIncome = async (id: string) => {
    if (deletingId) return;
    setDeletingId(`income:${id}`);
    try {
      await deleteIncome(id);
      await refreshAfterDelete();
    } catch (e) {
      toast.show({ kind: 'error', message: (e as Error)?.message ?? "Couldn't delete that income." });
    } finally {
      setDeletingId(null);
    }
  };

  // Category chips only apply to expenses; kind filter gates which
  // ledgers contribute to the unified feed.
  const filteredReceiptsForFeed = useMemo(() => {
    if (kindFilter === 'income') return [];
    if (activeFilter === FILTER_ALL) return receipts;
    return receipts.filter((r) => receiptMatchesCategory(r, activeFilter));
  }, [receipts, kindFilter, activeFilter]);

  const filteredIncomesForFeed = useMemo(() => {
    if (kindFilter === 'expenses') return [];
    return incomes;
  }, [incomes, kindFilter]);

  const feed: FeedItem[] = useMemo(() => {
    const items: FeedItem[] = [
      ...filteredReceiptsForFeed.map((r) => ({
        kind: 'expense' as const,
        id: r.id,
        date: r.date,
        receipt: r,
      })),
      ...filteredIncomesForFeed.map((i) => ({
        kind: 'income' as const,
        id: i.id,
        date: i.date,
        income: i,
      })),
    ];
    items.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
    return items;
  }, [filteredReceiptsForFeed, filteredIncomesForFeed]);

  const isFiltering =
    query.trim().length > 0 || kindFilter !== 'all' || activeFilter !== FILTER_ALL;
  const sections = groupByDate(feed);

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

  const kindChips: { key: KindFilter; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'income', label: 'Income' },
    { key: 'expenses', label: 'Expenses' },
  ];

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      {/* Header: activity headline + circular add → ActionSheet for
          expense vs income. */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Activity</Text>
        <TouchableOpacity
          style={styles.addButton}
          onPress={showAddSheet}
          accessibilityRole="button"
          accessibilityLabel="Add expense or income"
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
          placeholder="Search merchant or source"
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

      {/* Kind filter: All | Income | Expenses */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.filterScrollContainer}
        contentContainerStyle={styles.filterScroll}
      >
        {kindChips.map((item) => {
          const active = kindFilter === item.key;
          return (
            <TouchableOpacity
              key={item.key}
              onPress={() => {
                setKindFilter(item.key);
                if (item.key === 'income') setActiveFilter(FILTER_ALL);
              }}
              style={[styles.chip, active && styles.chipActive]}
            >
              <Text style={[styles.chipLabel, active && styles.chipLabelActive]}>
                {item.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      {/* Category filter chips — only for expenses (hidden on Income-only). */}
      {kindFilter !== 'income' ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.filterScrollContainer}
          contentContainerStyle={styles.filterScroll}
        >
          {([FILTER_ALL, ...ALL_CATEGORIES] as CategoryFilter[]).map((item) => {
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
      ) : null}

      {initialLoading ? (
        <View style={styles.listContent}>
          <ReceiptListSkeleton count={5} />
        </View>
      ) : sections.length === 0 ? (
        <View style={styles.listContent}>
          {isFiltering ? (
            <EmptyState icon="search-outline" title="No activity matches." />
          ) : (
            <EmptyState
              icon="receipt-outline"
              title="No activity yet"
              description="Add an expense or income and it'll show up here, grouped by date."
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
              tintColor={theme.colors.accent}
            />
          }
        >
          {sections.map((section) => (
            <View key={section.title}>
              <Text style={styles.sectionHeaderText}>{section.title}</Text>
              <View style={styles.card}>
                {section.data.map((item, idx) => {
                  const swipeKey = `${item.kind}:${item.id}`;
                  if (item.kind === 'income') {
                    const inc = item.income;
                    const memberName = memberDisplayName(
                      inc.earnedBy,
                      members,
                      user?.uid,
                    );
                    return (
                      <Swipeable
                        key={swipeKey}
                        ref={(ref) => {
                          swipeableRefs.current[swipeKey] = ref;
                        }}
                        hitSlop={{ left: -24 }}
                        renderRightActions={() => (
                          <TouchableOpacity
                            style={styles.deleteAction}
                            onPress={() => confirmDeleteIncome(inc)}
                            disabled={deletingId !== null}
                          >
                            {deletingId === swipeKey ? (
                              <ActivityIndicator color="#fff" />
                            ) : (
                              <>
                                <Ionicons name="trash" size={20} color="#fff" />
                                <Text style={styles.deleteActionText}>Delete</Text>
                              </>
                            )}
                          </TouchableOpacity>
                        )}
                      >
                        <TouchableOpacity
                          activeOpacity={0.8}
                          onPress={() => router.push(`/edit-income/${inc.id}` as never)}
                          style={[
                            styles.row,
                            idx < section.data.length - 1 && styles.rowDivider,
                          ]}
                        >
                          <View
                            style={[
                              styles.avatar,
                              { backgroundColor: `${theme.colors.success}26` },
                            ]}
                          >
                            <Text style={styles.avatarText}>
                              {INCOME_CATEGORY_ICONS[inc.category] ?? '💰'}
                            </Text>
                          </View>
                          <View style={styles.rowInfo}>
                            <Text style={styles.rowStoreName} numberOfLines={1}>
                              {incomeCategoryLabel(inc.category)}
                            </Text>
                            <Text style={styles.rowMeta}>
                              {inc.sourceName} · {memberName}
                            </Text>
                          </View>
                          <Text style={styles.rowAmountIncome}>
                            +{formatCurrency(inc.amountUsd, currency)}
                          </Text>
                        </TouchableOpacity>
                      </Swipeable>
                    );
                  }

                  const r = item.receipt;
                  const isRecurring = recurringStores.has(
                    r.storeName.trim().toLowerCase(),
                  );
                  return (
                    <Swipeable
                      key={swipeKey}
                      ref={(ref) => {
                        swipeableRefs.current[swipeKey] = ref;
                      }}
                      // Rows span the full screen width with no gap at the
                      // left edge, so this Swipeable's PanGestureHandler
                      // was claiming touches starting right at x=0 — the
                      // same strip the OS reads a system back-swipe from.
                      // Negative left hitSlop shrinks the handler's own
                      // recognized area away from that edge (without
                      // shrinking the touchable row itself), so an
                      // edge-starting drag is left for the system/
                      // navigation back gesture instead of being captured
                      // here. Matches the standard fix for this exact
                      // RNGH Swipeable-vs-back-gesture conflict (see
                      // software-mansion/react-native-gesture-handler#890).
                      hitSlop={{ left: -24 }}
                      renderRightActions={() => (
                        <TouchableOpacity
                          style={styles.deleteAction}
                          onPress={() => confirmDeleteReceipt(r)}
                          disabled={deletingId !== null}
                        >
                          {deletingId === swipeKey ? (
                            <ActivityIndicator color="#fff" />
                          ) : (
                            <>
                              <Ionicons name="trash" size={20} color="#fff" />
                              <Text style={styles.deleteActionText}>Delete</Text>
                            </>
                          )}
                        </TouchableOpacity>
                      )}
                    >
                      <TouchableOpacity
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
                            {
                              backgroundColor: `${
                                theme.colors.category[
                                  r.category as keyof typeof theme.colors.category
                                ] ?? theme.colors.accent
                              }26`,
                            },
                          ]}
                        >
                          <Text style={styles.avatarText}>
                            {CATEGORY_ICONS[r.category as keyof typeof CATEGORY_ICONS] ?? '🧾'}
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
                          {formatCurrency(r.totalAmount, currency)}
                        </Text>
                      </TouchableOpacity>
                    </Swipeable>
                  );
                })}
              </View>
            </View>
          ))}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}
