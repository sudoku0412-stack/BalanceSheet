import React, { useCallback, useState } from 'react';
import { ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { format } from 'date-fns';
import { ModalHeader } from '../../components/ui/ModalHeader';
import { EmptyState } from '../../components/ui/EmptyState';
import { useStyles, useTheme } from '../../constants/theme';
import { getAllReceipts, getAllSettlements, getCurrentHouseholdId } from '../../lib/database';
import { getHouseholdMembers, HouseholdMember } from '../../lib/cloudSync';
import { getCurrentUser } from '../../lib/auth';
import { getCurrency } from '../../lib/secureStorage';
import {
  computeReceiptNet,
  computeSettlementNet,
  getReceiptsForMemberPair,
  getSettlementsForMemberPair,
} from '../../lib/balances';
import { CurrencyCode, formatCurrency } from '../../lib/currency';
import { Receipt, Settlement } from '../../types';

function memberLabel(m: HouseholdMember | undefined): string {
  return m?.displayName?.trim() || m?.email || 'Household member';
}

type Row =
  | { kind: 'receipt'; date: string; receipt: Receipt; net: number }
  | { kind: 'settlement'; date: string; settlement: Settlement; net: number };

/** Shows ONLY the receipts split with this one household member — the
 *  filtered drill-down from the Balances screen's per-person row,
 *  distinct from the Expenses tab's unfiltered "everything" list. Each
 *  row shows that receipt's OWN owed/owing amount (not its full total),
 *  and the header total is the sum of those — same number the Balances
 *  screen shows for this person. */
export default function SharedExpensesScreen() {
  const theme = useTheme();
  const router = useRouter();
  const styles = useSharedExpensesStyles();
  const { uid: memberUid } = useLocalSearchParams<{ uid: string }>();
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<Row[]>([]);
  const [member, setMember] = useState<HouseholdMember | undefined>(undefined);
  const [currency, setCurrency] = useState<CurrencyCode>('USD');

  useFocusEffect(
    useCallback(() => {
      if (!memberUid) return;
      let mounted = true;
      (async () => {
        const uid = getCurrentUser()?.uid ?? null;
        const householdId = getCurrentHouseholdId();
        const [all, settlements, memberList, rawCurrency] = await Promise.all([
          getAllReceipts(),
          getAllSettlements(),
          householdId && uid
            ? getHouseholdMembers({ householdId, currentUid: uid })
            : Promise.resolve<HouseholdMember[] | null>(null),
          getCurrency(),
        ]);
        if (!mounted) return;
        setMember((memberList ?? []).find((m) => m.uid === memberUid));
        if (uid) {
          const receiptRows: Row[] = getReceiptsForMemberPair(all as Receipt[], uid, memberUid)
            .map((receipt) => ({
              kind: 'receipt' as const,
              date: receipt.date,
              receipt,
              net: computeReceiptNet(receipt, uid, memberUid),
            }))
            .filter((row) => Math.abs(row.net) > 0.005);
          const settlementRows: Row[] = getSettlementsForMemberPair(
            settlements as Settlement[],
            uid,
            memberUid,
          ).map((settlement) => ({
            kind: 'settlement' as const,
            date: settlement.createdAt,
            settlement,
            net: computeSettlementNet(settlement, uid, memberUid),
          }));
          const shared = [...receiptRows, ...settlementRows].sort(
            (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
          );
          setRows(shared);
        }
        if (rawCurrency) setCurrency(rawCurrency as CurrencyCode);
        setLoading(false);
      })();
      return () => {
        mounted = false;
      };
    }, [memberUid]),
  );

  const label = memberLabel(member);
  const totalNet = rows.reduce((sum, r) => sum + r.net, 0);
  const totalOwesYou = totalNet > 0;

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
      <ModalHeader title={`Shared with ${label}`} onBack={() => router.back()} />
      {!loading && rows.length === 0 ? (
        <EmptyState
          icon="receipt-outline"
          title="No shared expenses"
          description={`Nothing split with ${label} yet.`}
        />
      ) : (
        <ScrollView contentContainerStyle={styles.scroll}>
          {rows.length > 0 && (
            <View style={styles.totalCard}>
              <Text style={styles.totalLabel}>
                {totalOwesYou ? `${label} owes you` : `You owe ${label}`}
              </Text>
              <Text
                style={[
                  styles.totalAmount,
                  { color: totalOwesYou ? theme.colors.success : theme.colors.error },
                ]}
              >
                {formatCurrency(Math.abs(totalNet), currency)}
              </Text>
            </View>
          )}
          <View style={styles.card}>
            {rows.map((row, idx) => {
              const { net } = row;
              const oweYou = net > 0;
              if (row.kind === 'settlement') {
                const paidByYou = row.settlement.fromUid === getCurrentUser()?.uid;
                return (
                  <View
                    key={row.settlement.id}
                    style={[styles.row, idx < rows.length - 1 && styles.rowDivider]}
                  >
                    <View style={[styles.avatar, { backgroundColor: theme.colors.textMuted }]}>
                      <Text style={styles.avatarText}>✓</Text>
                    </View>
                    <View style={styles.rowInfo}>
                      <Text style={styles.rowStoreName} numberOfLines={1}>Settled up</Text>
                      <Text style={styles.rowMeta} numberOfLines={1}>
                        {format(new Date(row.date), 'MMM d')} ·{' '}
                        {paidByYou ? `You paid ${label}` : `${label} paid you`}
                      </Text>
                    </View>
                    <Text
                      style={[
                        styles.rowAmount,
                        { color: oweYou ? theme.colors.success : theme.colors.error },
                      ]}
                    >
                      {formatCurrency(Math.abs(net), currency)}
                    </Text>
                  </View>
                );
              }
              const r = row.receipt;
              return (
                <TouchableOpacity
                  key={r.id}
                  activeOpacity={0.8}
                  onPress={() => router.push(`/edit/${r.id}`)}
                  style={[styles.row, idx < rows.length - 1 && styles.rowDivider]}
                >
                  <View style={[styles.avatar, { backgroundColor: theme.colors.category[r.category] }]}>
                    <Text style={styles.avatarText}>{r.storeName.charAt(0).toUpperCase()}</Text>
                  </View>
                  <View style={styles.rowInfo}>
                    <Text style={styles.rowStoreName} numberOfLines={1}>{r.storeName}</Text>
                    <Text style={styles.rowMeta} numberOfLines={1}>
                      {format(new Date(r.date), 'MMM d')} · {oweYou ? `${label} owes you` : `You owe ${label}`}
                    </Text>
                  </View>
                  <Text
                    style={[
                      styles.rowAmount,
                      { color: oweYou ? theme.colors.success : theme.colors.error },
                    ]}
                  >
                    {formatCurrency(Math.abs(net), currency)}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function useSharedExpensesStyles() {
  return useStyles((theme) => ({
    screen: { flex: 1, backgroundColor: theme.colors.background },
    scroll: {
      paddingHorizontal: theme.spacing.lg,
      paddingTop: theme.spacing.lg,
      paddingBottom: theme.spacing.xl,
    },
    totalCard: {
      backgroundColor: theme.colors.surface,
      borderRadius: theme.radius.lg,
      borderWidth: 1,
      borderColor: theme.colors.border,
      paddingHorizontal: theme.spacing.md,
      paddingVertical: theme.spacing.md,
      marginBottom: theme.spacing.md,
      alignItems: 'center',
    },
    totalLabel: {
      color: theme.colors.textSecondary,
      fontSize: theme.font.sm,
      fontFamily: theme.fonts.body.regular,
      marginBottom: 4,
    },
    totalAmount: {
      fontSize: theme.font.xxl,
      fontFamily: theme.fonts.display.extraBold,
    },
    card: {
      backgroundColor: theme.colors.surface,
      borderRadius: theme.radius.lg,
      borderWidth: 1,
      borderColor: theme.colors.border,
      overflow: 'hidden',
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: theme.spacing.md,
      paddingVertical: 12,
    },
    rowDivider: {
      borderBottomWidth: 1,
      borderBottomColor: theme.colors.border,
    },
    avatar: {
      width: 36,
      height: 36,
      borderRadius: theme.radius.full,
      alignItems: 'center',
      justifyContent: 'center',
      flexShrink: 0,
    },
    avatarText: {
      color: '#FFFFFF',
      fontSize: theme.font.sm,
      fontFamily: theme.fonts.display.bold,
    },
    rowInfo: {
      flex: 1,
      marginLeft: theme.spacing.md,
      marginRight: theme.spacing.sm,
    },
    rowStoreName: {
      color: theme.colors.textPrimary,
      fontSize: theme.font.md,
      fontFamily: theme.fonts.display.bold,
    },
    rowMeta: {
      color: theme.colors.textMuted,
      fontSize: theme.font.xs,
      fontFamily: theme.fonts.body.regular,
      marginTop: 2,
    },
    rowAmount: {
      fontSize: theme.font.md,
      fontFamily: theme.fonts.display.extraBold,
      flexShrink: 0,
      textAlign: 'right',
    },
  }));
}
