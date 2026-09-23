import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  RefreshControl,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Swipeable } from 'react-native-gesture-handler';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { format, isToday, isYesterday } from 'date-fns';
import { ModalHeader } from '../components/ui/ModalHeader';
import { EmptyState } from '../components/ui/EmptyState';
import { useStyles, useTheme } from '../constants/theme';
import { INCOME_CATEGORY_ICONS, incomeCategoryLabel } from '../constants/incomeCategories';
import { useAuth } from '../lib/AuthContext';
import { isInCalendarMonth } from '../lib/calendarDate';
import { getHouseholdMembers, HouseholdMember } from '../lib/cloudSync';
import { CurrencyCode, formatCurrency } from '../lib/currency';
import { onLocalDataChanged } from '../lib/dataSync';
import {
  deleteIncome,
  getAllIncomes,
  getCurrentHouseholdId,
  searchIncomes,
} from '../lib/database';
import { getCurrency } from '../lib/secureStorage';
import { useToast } from '../components/ui/Toast';
import { Income } from '../types';

function dateGroupLabel(dateStr: string): string {
  const d = new Date(dateStr);
  if (isToday(d)) return 'Today';
  if (isYesterday(d)) return 'Yesterday';
  return format(d, 'MMM d, yyyy');
}

function memberName(
  uid: string,
  members: HouseholdMember[],
  currentUid: string | undefined,
): string {
  if (currentUid && uid === currentUid) return 'You';
  const m = members.find((x) => x.uid === uid);
  if (m?.isYou) return 'You';
  return m?.displayName?.trim() || m?.email?.trim() || (uid.length > 8 ? `${uid.slice(0, 6)}…` : uid);
}

export default function IncomesScreen() {
  const theme = useTheme();
  const toast = useToast();
  const { user } = useAuth();
  const params = useLocalSearchParams<{ earnedBy?: string; year?: string; month?: string }>();
  const styles = useStyles((t) => ({
    root: { flex: 1, backgroundColor: t.colors.background },
    search: {
      flexDirection: 'row' as const,
      alignItems: 'center' as const,
      gap: 8,
      marginHorizontal: t.spacing.md,
      marginBottom: t.spacing.sm,
      paddingHorizontal: 12,
      paddingVertical: 10,
      borderRadius: t.radius.lg,
      backgroundColor: t.colors.surface,
      borderWidth: 1,
      borderColor: t.colors.border,
    },
    searchInput: {
      flex: 1,
      color: t.colors.textPrimary,
      fontFamily: t.fonts.body.regular,
      fontSize: t.font.sm,
    },
    list: { paddingHorizontal: t.spacing.md, paddingBottom: 48, flexGrow: 1 },
    sectionTitle: {
      fontFamily: t.fonts.display.bold,
      fontSize: t.font.sm,
      color: t.colors.textSecondary,
      paddingTop: t.spacing.sm,
      paddingBottom: t.spacing.xs,
    },
    card: {
      backgroundColor: t.colors.surface,
      borderRadius: 20,
      overflow: 'hidden' as const,
      marginBottom: t.spacing.sm,
    },
    row: {
      flexDirection: 'row' as const,
      alignItems: 'center' as const,
      gap: t.spacing.sm,
      padding: t.spacing.md,
    },
    divider: { borderBottomWidth: 1, borderBottomColor: t.colors.border },
    avatar: {
      width: 44,
      height: 44,
      borderRadius: 14,
      alignItems: 'center' as const,
      justifyContent: 'center' as const,
    },
    title: {
      fontFamily: t.fonts.display.bold,
      fontSize: t.font.md,
      color: t.colors.textPrimary,
    },
    meta: {
      fontFamily: t.fonts.body.regular,
      fontSize: t.font.xs,
      color: t.colors.textMuted,
    },
    amount: {
      fontFamily: t.fonts.mono.medium,
      fontSize: t.font.md,
      color: t.colors.success,
      marginLeft: 'auto' as const,
    },
    deleteAction: {
      backgroundColor: t.colors.error,
      justifyContent: 'center' as const,
      alignItems: 'center' as const,
      width: 84,
    },
    deleteText: {
      color: '#fff',
      fontFamily: t.fonts.display.bold,
      fontSize: t.font.xs,
    },
    totalLine: {
      color: t.colors.textSecondary,
      fontFamily: t.fonts.body.regular,
      fontSize: t.font.xs,
      paddingHorizontal: t.spacing.md,
      paddingBottom: t.spacing.sm,
    },
  }));

  const [incomes, setIncomes] = useState<Income[]>([]);
  const [members, setMembers] = useState<HouseholdMember[]>([]);
  const [currency, setCurrency] = useState<CurrencyCode>('USD');
  const [query, setQuery] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const swipeableRefs = useRef<Record<string, Swipeable | null>>({});

  const load = useCallback(async () => {
    const hid = getCurrentHouseholdId();
    const [rows, code, memberList] = await Promise.all([
      query.trim() ? searchIncomes(query.trim()) : getAllIncomes(),
      getCurrency(),
      hid && user?.uid
        ? getHouseholdMembers({ householdId: hid, currentUid: user.uid })
        : Promise.resolve(null),
    ]);
    setIncomes(rows);
    setCurrency((code as CurrencyCode | null) ?? 'USD');
    setMembers(memberList ?? []);
  }, [query, user?.uid]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  React.useEffect(() => onLocalDataChanged(() => load()), [load]);

  const year = params.year ? Number(params.year) : NaN;
  const month = params.month ? Number(params.month) : NaN;
  const hasMonth = Number.isInteger(year) && Number.isInteger(month) && month >= 1 && month <= 12;
  const earnedBy = typeof params.earnedBy === 'string' ? params.earnedBy : '';

  const visible = useMemo(() => {
    return incomes.filter((row) => {
      if (earnedBy && row.earnedBy !== earnedBy) return false;
      if (hasMonth && !isInCalendarMonth(row.date, year, month)) return false;
      return true;
    });
  }, [incomes, earnedBy, hasMonth, year, month]);

  const sections = useMemo(() => {
    const groups: { title: string; data: Income[] }[] = [];
    for (const row of visible) {
      const title = dateGroupLabel(row.date);
      const last = groups[groups.length - 1];
      if (last && last.title === title) last.data.push(row);
      else groups.push({ title, data: [row] });
    }
    return groups;
  }, [visible]);

  const totalUsd = visible.reduce((s, i) => s + (i.amountUsd || 0), 0);

  const confirmDelete = (income: Income) => {
    swipeableRefs.current[income.id]?.close();
    Alert.alert('Delete income', 'This action cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          if (deletingId) return;
          setDeletingId(income.id);
          try {
            await deleteIncome(income.id);
            await load();
          } catch (e) {
            toast.show({ kind: 'error', message: (e as Error)?.message ?? "Couldn't delete that income." });
          } finally {
            setDeletingId(null);
          }
        },
      },
    ]);
  };

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <ModalHeader
        title="Incomes"
        iconLeading="💰"
        rightActions={[
          {
            icon: 'add',
            onPress: () => router.push('/add-income' as never),
            accessibilityLabel: 'Add income',
          },
        ]}
      />
      <Text style={styles.totalLine}>
        {visible.length} {visible.length === 1 ? 'entry' : 'entries'} · {formatCurrency(totalUsd, currency)}
      </Text>
      <View style={styles.search}>
        <Ionicons name="search-outline" size={18} color={theme.colors.accent} />
        <TextInput
          style={styles.searchInput}
          value={query}
          onChangeText={setQuery}
          placeholder="Search source or notes"
          placeholderTextColor={theme.colors.textMuted}
          returnKeyType="search"
          testID="incomes-search"
        />
      </View>
      {sections.length === 0 ? (
        <View style={styles.list}>
          <EmptyState
            icon="cash-outline"
            title="No incomes yet"
            description="Add a paycheck or other income and it will show up here."
            actionLabel="Add income"
            onAction={() => router.push('/add-income' as never)}
          />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={async () => {
              setRefreshing(true);
              try {
                await load();
              } finally {
                setRefreshing(false);
              }
            }} tintColor={theme.colors.accent} />
          }
        >
          {sections.map((section) => (
            <View key={section.title}>
              <Text style={styles.sectionTitle}>{section.title}</Text>
              <View style={styles.card}>
                {section.data.map((inc, idx) => (
                  <Swipeable
                    key={inc.id}
                    ref={(ref) => {
                      swipeableRefs.current[inc.id] = ref;
                    }}
                    renderRightActions={() => (
                      <TouchableOpacity
                        style={styles.deleteAction}
                        onPress={() => confirmDelete(inc)}
                        disabled={deletingId !== null}
                      >
                        {deletingId === inc.id ? (
                          <ActivityIndicator color="#fff" />
                        ) : (
                          <>
                            <Ionicons name="trash" size={20} color="#fff" />
                            <Text style={styles.deleteText}>Delete</Text>
                          </>
                        )}
                      </TouchableOpacity>
                    )}
                  >
                    <TouchableOpacity
                      activeOpacity={0.8}
                      onPress={() => router.push(`/edit-income/${inc.id}` as never)}
                      style={[styles.row, idx < section.data.length - 1 && styles.divider]}
                      testID={`income-row-${inc.id}`}
                    >
                      <View style={[styles.avatar, { backgroundColor: `${theme.colors.success}26` }]}>
                        <Text>{INCOME_CATEGORY_ICONS[inc.category] ?? '💰'}</Text>
                      </View>
                      <View style={{ flex: 1, gap: 2 }}>
                        <Text style={styles.title} numberOfLines={1}>
                          {inc.sourceName}
                        </Text>
                        <Text style={styles.meta}>
                          {incomeCategoryLabel(inc.category)} · {memberName(inc.earnedBy, members, user?.uid)}
                        </Text>
                      </View>
                      <Text style={styles.amount}>+{formatCurrency(inc.amountUsd, currency)}</Text>
                    </TouchableOpacity>
                  </Swipeable>
                ))}
              </View>
            </View>
          ))}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}
