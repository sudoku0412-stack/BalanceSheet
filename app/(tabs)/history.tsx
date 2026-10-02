import { tr } from '../../lib/i18n';
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
import { ALL_CATEGORIES, categoryIcon } from '../../constants/categories';
import {
  getCustomCategories,
  resolveCategoryColor,
  type CustomCategory,
} from '../../lib/customCategories';
import { INCOME_CATEGORY_ICONS, incomeCategoryLabel } from '../../constants/incomeCategories';
import { EmptyState } from '../../components/ui/EmptyState';
import { ReceiptListSkeleton } from '../../components/ui/Skeleton';
import { useToast } from '../../components/ui/Toast';
import { categoryLabel } from '../../lib/categoryLabel';
import { receiptMatchesCategory } from '../../lib/receiptFilter';
import { isInCalendarMonth } from '../../lib/calendarDate';
import { findRecurring } from '../../lib/reports';
import { onLocalDataChanged } from '../../lib/dataSync';
import { getHouseholdMembers, HouseholdMember } from '../../lib/cloudSync';
import { useAuth } from '../../lib/AuthContext';

import { useT, useLanguage } from '../../lib/I18nContext';
import { relativeDayLabel } from '../../lib/dateLocale';
import type { Language } from '../../lib/i18n';
const FILTER_ALL = 'All' as const;
type CategoryFilter = typeof FILTER_ALL | Category | string;
type KindFilter = 'all' | 'income' | 'expenses';

type FeedItem =
  | { kind: 'expense'; id: string; date: string; receipt: Receipt }
  | { kind: 'income'; id: string; date: string; income: Income };

/** "Today" / "Yesterday" / "Jul 27" — the date-group label used to
 *  section the expense list, per the design spec's grouped-list layout. */
function dateGroupLabel(dateStr: string, language: Language): string {
  return relativeDayLabel(new Date(dateStr), language);
}

/** Groups an already date-sorted (DESC) feed into consecutive
 *  { title, data } sections keyed by date-group label. */
function groupIncomesByMember(
  items: FeedItem[],
  members: HouseholdMember[],
  currentUid: string | undefined,
): { title: string; data: FeedItem[] }[] {
  const buckets = new Map<string, FeedItem[]>();
  for (const item of items) {
    if (item.kind !== 'income') continue;
    const key = item.income.earnedBy || 'unknown';
    const list = buckets.get(key) ?? [];
    list.push(item);
    buckets.set(key, list);
  }
  return [...buckets.entries()]
    .map(([uid, data]) => ({
      uid,
      title: memberDisplayName(uid, members, currentUid),
      total: data.reduce((s, i) => s + (i.kind === 'income' ? i.income.amountUsd : 0), 0),
      data,
    }))
    .sort((a, b) => b.total - a.total)
    .map(({ title, data }) => ({ title, data }));
}

function groupByDate(items: FeedItem[], language: Language): { title: string; data: FeedItem[] }[] {
  const sections: { title: string; data: FeedItem[] }[] = [];
  for (const item of items) {
    const label = dateGroupLabel(item.date, language);
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
  if (currentUid && uid === currentUid) return tr('you');
  const m = members.find((x) => x.uid === uid);
  if (m?.isYou) return tr('you');
  return m?.displayName?.trim() || m?.email?.trim() || truncateUid(uid);
}

export default function HistoryScreen() {
  const t = useT();
  const { language } = useLanguage();
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
  const [customs, setCustoms] = useState<CustomCategory[]>([]);
  const [currency, setCurrency] = useState<CurrencyCode>('USD');
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const swipeableRefs = useRef<Record<string, Swipeable | null>>({});
  const params = useLocalSearchParams<{
    category?: string;
    kind?: string;
    group?: string;
    year?: string;
    month?: string;
  }>();

  // This screen renders its own "Activity" headline + add button per the
  // design spec, so the default per-tab native header ("History") is
  // suppressed here rather than in the shared tab layout.
  useEffect(() => {
    navigation.setOptions({ headerShown: false });
  }, [navigation]);

  // Dashboard (and others) can deep-link: kind=income|expenses,
  // group=member, year+month, and/or category=X for expenses.
  useEffect(() => {
    if (params.kind === 'income' || params.kind === 'expenses' || params.kind === 'all') {
      setKindFilter(params.kind);
      if (params.kind === 'income') setActiveFilter(FILTER_ALL);
    }
    if (
      params.category &&
      (ALL_CATEGORIES as readonly string[]).includes(params.category)
    ) {
      setKindFilter('expenses');
      setActiveFilter(params.category as Category);
    }
  }, [params.kind, params.category]);

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
    const hid = getCurrentHouseholdId();
    setCustoms(hid ? await getCustomCategories(hid).catch(() => [] as CustomCategory[]) : []);
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
    Alert.alert(t('add'), undefined, [
      {
        text: t('addExpense'),
        onPress: () => router.push('/(tabs)/scan?mode=manual'),
      },
      {
        text: t('addIncome'),
        onPress: () => router.push('/add-income' as never),
      },
      { text: t('cancel'), style: 'cancel' },
    ]);
  };

  // Swipe-to-delete for an expense row, mirroring households.tsx's
  // Swipeable delete pattern: swipe left to reveal a Delete action,
  // confirm via Alert, then delete and refresh the list.
  const confirmDeleteReceipt = (receipt: Receipt) => {
    swipeableRefs.current[`expense:${receipt.id}`]?.close();
    Alert.alert(t('deleteReceipt'), t('thisActionCannotBeUndone'), [
      { text: t('cancel'), style: 'cancel' },
      {
        text: t('delete'),
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
      toast.show({ kind: 'error', message: (e as Error)?.message ?? t('couldnTDeleteThatReceipt') });
    } finally {
      setDeletingId(null);
    }
  };

  const confirmDeleteIncome = (income: Income) => {
    swipeableRefs.current[`income:${income.id}`]?.close();
    Alert.alert(t('deleteIncome'), t('thisActionCannotBeUndone'), [
      { text: t('cancel'), style: 'cancel' },
      {
        text: t('delete'),
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
      toast.show({ kind: 'error', message: (e as Error)?.message ?? t('couldnTDeleteThatIncome') });
    } finally {
      setDeletingId(null);
    }
  };

  // Category chips only apply to expenses; kind filter gates which
  // ledgers contribute to the unified feed.
  const monthYear = params.year ? Number(params.year) : NaN;
  const monthNum = params.month ? Number(params.month) : NaN;
  const hasMonthFilter = Number.isInteger(monthYear) && Number.isInteger(monthNum) && monthNum >= 1 && monthNum <= 12;

  const filteredReceiptsForFeed = useMemo(() => {
    if (kindFilter === 'income') return [];
    const scoped = hasMonthFilter
      ? receipts.filter((r) => isInCalendarMonth(r.date, monthYear, monthNum))
      : receipts;
    if (activeFilter === FILTER_ALL) return scoped;
    return scoped.filter((r) => receiptMatchesCategory(r, activeFilter));
  }, [receipts, kindFilter, activeFilter, hasMonthFilter, monthYear, monthNum]);

  const filteredIncomesForFeed = useMemo(() => {
    if (kindFilter === 'expenses') return [];
    if (!hasMonthFilter) return incomes;
    return incomes.filter((i) => isInCalendarMonth(i.date, monthYear, monthNum));
  }, [incomes, kindFilter, hasMonthFilter, monthYear, monthNum]);

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

  const groupByMember = params.group === 'member' && kindFilter === 'income';
  const isFiltering =
    query.trim().length > 0 ||
    kindFilter !== 'all' ||
    activeFilter !== FILTER_ALL ||
    hasMonthFilter ||
    groupByMember;
  const sections = groupByMember
    ? groupIncomesByMember(feed, members, user?.uid)
    : groupByDate(feed, language);

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
    { key: 'all', label: t('all') },
    { key: 'income', label: t('income') },
    { key: 'expenses', label: t('expenses') },
  ];

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      {/* Header: activity headline + circular add → ActionSheet for
          expense vs income. */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>
          {kindFilter === 'income' ? (groupByMember ? t('incomeByPerson') : t('income')) : t('activity')}
        </Text>
        <TouchableOpacity
          style={styles.addButton}
          onPress={showAddSheet}
          accessibilityRole="button"
          accessibilityLabel={t('addExpenseOrIncome')}
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
          placeholder={t('searchMerchantOrSource')}
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
          {([FILTER_ALL, ...ALL_CATEGORIES, ...customs.map((c) => c.name)] as CategoryFilter[]).map((item) => {
            const active = activeFilter === item;
            return (
              <TouchableOpacity
                key={item}
                onPress={() => setActiveFilter(item)}
                style={[styles.chip, active && styles.chipActive]}
              >
                <Text style={[styles.chipLabel, active && styles.chipLabelActive]}>
                  {item === FILTER_ALL ? t('all') : categoryLabel(item)}
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
            <EmptyState icon="search-outline" title={t('noActivityMatches')} />
          ) : (
            <EmptyState
              icon="receipt-outline"
              title={t('noActivityYet')}
              description={t('addAnExpenseOrIncome')}
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
                                <Text style={styles.deleteActionText}>{t('delete')}</Text>
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
                              <Text style={styles.deleteActionText}>{t('delete')}</Text>
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
                                resolveCategoryColor(
                                  r.category,
                                  theme.colors.category,
                                  customs,
                                  theme.colors.accent,
                                )
                              }26`,
                            },
                          ]}
                        >
                          <Text style={styles.avatarText}>
                            {categoryIcon(r.category, '🧾')}
                          </Text>
                        </View>
                        <View style={styles.rowInfo}>
                          <Text style={styles.rowStoreName} numberOfLines={1}>
                            {r.storeName}
                          </Text>
                          <Text style={styles.rowMeta}>
                            {categoryLabel(r.category)}
                            {isRecurring ? t('recurring') : ''}
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
