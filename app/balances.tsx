import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, AppState, ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ModalHeader } from '../components/ui/ModalHeader';
import { EmptyState } from '../components/ui/EmptyState';
import { useToast } from '../components/ui/Toast';
import { useStyles, useTheme } from '../constants/theme';
import { getAllReceipts, getAllSettlements, getCurrentHouseholdId, insertSettlement } from '../lib/database';
import { getHouseholdMembers, HouseholdMember } from '../lib/cloudSync';
import { getCurrentUser } from '../lib/auth';
import { useAuth } from '../lib/AuthContext';
import { getCurrency } from '../lib/secureStorage';
import { v4 as uuidv4 } from 'uuid';
import { computeMemberBalances, MemberBalance } from '../lib/balances';
import { CurrencyCode, formatCurrency } from '../lib/currency';
import { notifySettleUp } from '../lib/notifications';
import { Receipt, Settlement } from '../types';

function memberLabel(m: HouseholdMember): string {
  return m.displayName?.trim() || m.email || 'Household member';
}

function initialFor(label: string): string {
  const parts = label.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return '·';
}

export default function BalancesScreen() {
  const theme = useTheme();
  const router = useRouter();
  const toast = useToast();
  const { profile } = useAuth();
  const styles = useBalancesStyles();
  const [loading, setLoading] = useState(true);
  const [balances, setBalances] = useState<MemberBalance[]>([]);
  const [members, setMembers] = useState<HouseholdMember[]>([]);
  const [currency, setCurrency] = useState<CurrencyCode>('USD');
  const [settlingUid, setSettlingUid] = useState<string | null>(null);

  const load = useCallback(async () => {
    const uid = getCurrentUser()?.uid;
    const householdId = getCurrentHouseholdId();
    const [receipts, settlements, memberList, rawCurrency] = await Promise.all([
      getAllReceipts(),
      getAllSettlements(),
      householdId && uid
        ? getHouseholdMembers({ householdId, currentUid: uid })
        : Promise.resolve<HouseholdMember[] | null>(null),
      getCurrency(),
    ]);
    const memberArr = memberList ?? [];
    setMembers(memberArr);
    if (uid) {
      setBalances(computeMemberBalances(receipts as Receipt[], settlements as Settlement[], uid, memberArr));
    }
    if (rawCurrency) setCurrency(rawCurrency as CurrencyCode);
    setLoading(false);
  }, []);

  useFocusEffect(
    useCallback(() => {
      let mounted = true;
      (async () => {
        await load();
        if (!mounted) return;
      })();
      return () => {
        mounted = false;
      };
    }, [load]),
  );

  // useFocusEffect only fires on navigation focus changes — if this
  // screen was already focused when the app got backgrounded (e.g. the
  // household member tapped a "settled up"/shared-expense push while
  // Balances was already open), resuming the app is an AppState change
  // with no navigation event, so the data above would otherwise stay
  // stale until the user manually left and came back to this screen.
  const appState = useRef(AppState.currentState);
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (appState.current !== 'active' && nextState === 'active') {
        load();
      }
      appState.current = nextState;
    });
    return () => subscription.remove();
  }, [load]);

  // Either side of a balance can settle it — the debtor confirming they
  // paid, or the person owed confirming they got paid (in cash, e-transfer,
  // etc. — outside the app). Whoever taps it just records who actually
  // owed whom, not who happened to press the button.
  const confirmSettleUp = (memberUid: string, label: string, theyOweYou: boolean, amountUsd: number) => {
    const fromUid = theyOweYou ? memberUid : (getCurrentUser()?.uid ?? '');
    const toUid = theyOweYou ? (getCurrentUser()?.uid ?? '') : memberUid;
    const message = theyOweYou
      ? `Mark ${formatCurrency(amountUsd, currency)} from ${label} as received? This only clears the balance between you two — it doesn't change any expense totals.`
      : `Mark ${formatCurrency(amountUsd, currency)} as paid to ${label}? This only clears the balance between you two — it doesn't change any expense totals.`;
    Alert.alert('Settle up?', message, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Settle up', onPress: () => settleUp(memberUid, fromUid, toUid, amountUsd) },
    ]);
  };

  const settleUp = async (memberUid: string, fromUid: string, toUid: string, amountUsd: number) => {
    if (!fromUid || !toUid || settlingUid) return;
    const selfUid = getCurrentUser()?.uid;
    setSettlingUid(memberUid);
    try {
      await insertSettlement({
        id: uuidv4(),
        fromUid,
        toUid,
        amountUsd,
        createdAt: new Date().toISOString(),
      });
      await load();
      toast.show({ kind: 'success', message: 'Settled up' });
      const actorLabel = profile ? `${profile.firstName} ${profile.lastName}`.trim() : 'Someone';
      void notifySettleUp({
        toUid: memberUid,
        actorLabel,
        amountLabel: formatCurrency(amountUsd, currency),
        actorIsPayer: fromUid === selfUid,
      });
    } catch (e) {
      toast.show({ kind: 'error', message: (e as Error)?.message ?? "Couldn't settle up" });
    } finally {
      setSettlingUid(null);
    }
  };

  const memberByUid = new Map(members.map((m) => [m.uid, m]));
  // Keep a row for anyone with ANY shared-expense history, even once
  // fully settled — settling shouldn't make the pair vanish, just show
  // $0.00. Members never split with at all still don't clutter the list.
  const withHistory = balances.filter((b) => b.receiptIds.length > 0);

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
      <ModalHeader title="Balances" onBack={() => router.back()} />
      {!loading && withHistory.length === 0 ? (
        <EmptyState
          icon="swap-horizontal-outline"
          title="All settled up"
          description="Split an expense with a household member and their balance will show up here."
        />
      ) : (
        <ScrollView contentContainerStyle={styles.scroll}>
          {withHistory.map((b) => {
            const m = memberByUid.get(b.memberUid);
            const label = m ? memberLabel(m) : 'Household member';
            const isSettled = Math.abs(b.netUsd) <= 0.005;
            const theyOweYou = b.netUsd > 0;
            const statusColor = isSettled
              ? theme.colors.textMuted
              : theyOweYou
                ? theme.colors.success
                : theme.colors.error;
            return (
              <View key={b.memberUid} style={styles.card}>
                <TouchableOpacity
                  activeOpacity={0.7}
                  style={styles.row}
                  onPress={() => router.push(`/shared-expenses/${b.memberUid}`)}
                >
                  <View style={styles.avatar}>
                    <Text style={styles.avatarInitials}>{initialFor(label)}</Text>
                  </View>
                  <View style={{ flex: 1, marginLeft: theme.spacing.md }}>
                    <Text style={styles.name} numberOfLines={1}>{label}</Text>
                    <Text style={[styles.direction, { color: statusColor }]}>
                      {isSettled ? 'Settled up' : theyOweYou ? 'Owes you' : 'You owe'}
                    </Text>
                  </View>
                  <Text style={[styles.amount, { color: statusColor }]}>
                    {formatCurrency(Math.abs(b.netUsd), currency)}
                  </Text>
                </TouchableOpacity>
                {!isSettled && (
                  <TouchableOpacity
                    activeOpacity={0.7}
                    disabled={settlingUid === b.memberUid}
                    style={[styles.settleBtn, settlingUid === b.memberUid && styles.settleBtnDisabled]}
                    onPress={() => confirmSettleUp(b.memberUid, label, theyOweYou, Math.abs(b.netUsd))}
                  >
                    <Text style={styles.settleBtnText}>
                      {settlingUid === b.memberUid
                        ? 'Settling…'
                        : theyOweYou
                          ? 'Mark as received'
                          : 'Settle up'}
                    </Text>
                  </TouchableOpacity>
                )}
              </View>
            );
          })}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function useBalancesStyles() {
  return useStyles((theme) => ({
    screen: { flex: 1, backgroundColor: theme.colors.background },
    scroll: {
      paddingHorizontal: theme.spacing.lg,
      paddingTop: theme.spacing.lg,
      paddingBottom: theme.spacing.xl,
    },
    card: {
      backgroundColor: theme.colors.surface,
      borderRadius: theme.radius.lg,
      borderWidth: 1,
      borderColor: theme.colors.border,
      marginBottom: theme.spacing.sm,
      overflow: 'hidden',
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: theme.spacing.md,
      paddingVertical: theme.spacing.md,
    },
    settleBtn: {
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: 12,
      borderTopWidth: 1,
      borderTopColor: theme.colors.border,
    },
    settleBtnDisabled: {
      opacity: 0.5,
    },
    settleBtnText: {
      // accent, not primary — primary is dark navy and invisible on the
      // dark-mode surface this button sits on (see HANDOVER.md).
      color: theme.colors.accent,
      fontSize: theme.font.sm,
      fontFamily: theme.fonts.display.bold,
    },
    avatar: {
      width: 40,
      height: 40,
      borderRadius: theme.radius.full,
      backgroundColor: theme.colors.primary,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: theme.isDark ? 1 : 0,
      borderColor: theme.isDark ? theme.colors.borderLight : 'transparent',
    },
    avatarInitials: {
      color: '#FFFFFF',
      fontSize: theme.font.sm,
      fontFamily: theme.fonts.display.bold,
    },
    name: {
      color: theme.colors.textPrimary,
      fontSize: theme.font.md,
      fontFamily: theme.fonts.display.bold,
    },
    direction: {
      fontSize: theme.font.xs,
      fontFamily: theme.fonts.body.regular,
      marginTop: 2,
    },
    amount: {
      fontSize: theme.font.md,
      fontFamily: theme.fonts.display.extraBold,
    },
  }));
}
