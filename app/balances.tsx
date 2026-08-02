import React, { useCallback, useState } from 'react';
import { ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ModalHeader } from '../components/ui/ModalHeader';
import { EmptyState } from '../components/ui/EmptyState';
import { useStyles, useTheme } from '../constants/theme';
import { getAllReceipts, getCurrentHouseholdId } from '../lib/database';
import { getHouseholdMembers, HouseholdMember } from '../lib/cloudSync';
import { getCurrentUser } from '../lib/auth';
import { getCurrency } from '../lib/secureStorage';
import { computeMemberBalances, MemberBalance } from '../lib/balances';
import { CurrencyCode, formatCurrency } from '../lib/currency';
import { Receipt } from '../types';

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
  const styles = useBalancesStyles();
  const [loading, setLoading] = useState(true);
  const [balances, setBalances] = useState<MemberBalance[]>([]);
  const [members, setMembers] = useState<HouseholdMember[]>([]);
  const [currency, setCurrency] = useState<CurrencyCode>('USD');

  useFocusEffect(
    useCallback(() => {
      let mounted = true;
      (async () => {
        const uid = getCurrentUser()?.uid;
        const householdId = getCurrentHouseholdId();
        const [receipts, memberList, rawCurrency] = await Promise.all([
          getAllReceipts(),
          householdId && uid
            ? getHouseholdMembers({ householdId, currentUid: uid })
            : Promise.resolve<HouseholdMember[] | null>(null),
          getCurrency(),
        ]);
        if (!mounted) return;
        const memberArr = memberList ?? [];
        setMembers(memberArr);
        if (uid) {
          setBalances(computeMemberBalances(receipts as Receipt[], uid, memberArr));
        }
        if (rawCurrency) setCurrency(rawCurrency as CurrencyCode);
        setLoading(false);
      })();
      return () => {
        mounted = false;
      };
    }, []),
  );

  const memberByUid = new Map(members.map((m) => [m.uid, m]));
  const nonZero = balances.filter((b) => Math.abs(b.netUsd) > 0.005);

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
      <ModalHeader title="Balances" onBack={() => router.back()} />
      {!loading && nonZero.length === 0 ? (
        <EmptyState
          icon="swap-horizontal-outline"
          title="All settled up"
          description="Split an expense with a household member and their balance will show up here."
        />
      ) : (
        <ScrollView contentContainerStyle={styles.scroll}>
          {nonZero.map((b) => {
            const m = memberByUid.get(b.memberUid);
            const label = m ? memberLabel(m) : 'Household member';
            const theyOweYou = b.netUsd > 0;
            return (
              <TouchableOpacity
                key={b.memberUid}
                activeOpacity={0.7}
                style={styles.row}
                onPress={() => router.push(`/shared-expenses/${b.memberUid}`)}
              >
                <View style={styles.avatar}>
                  <Text style={styles.avatarInitials}>{initialFor(label)}</Text>
                </View>
                <View style={{ flex: 1, marginLeft: theme.spacing.md }}>
                  <Text style={styles.name} numberOfLines={1}>{label}</Text>
                  <Text
                    style={[
                      styles.direction,
                      { color: theyOweYou ? theme.colors.success : theme.colors.error },
                    ]}
                  >
                    {theyOweYou ? 'Owes you' : 'You owe'}
                  </Text>
                </View>
                <Text
                  style={[
                    styles.amount,
                    { color: theyOweYou ? theme.colors.success : theme.colors.error },
                  ]}
                >
                  {formatCurrency(Math.abs(b.netUsd), currency)}
                </Text>
              </TouchableOpacity>
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
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: theme.colors.surface,
      borderRadius: theme.radius.lg,
      borderWidth: 1,
      borderColor: theme.colors.border,
      paddingHorizontal: theme.spacing.md,
      paddingVertical: theme.spacing.md,
      marginBottom: theme.spacing.sm,
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
