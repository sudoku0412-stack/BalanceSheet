import React, { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { Swipeable } from 'react-native-gesture-handler';
import { useFocusEffect, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { ModalHeader } from '../components/ui/ModalHeader';
import { EmptyState } from '../components/ui/EmptyState';
import { useStyles, useTheme } from '../constants/theme';
import { useToast } from '../components/ui/Toast';
import { useAuth } from '../lib/AuthContext';
import {
  deleteAllRowsForHousehold,
  getAllReceiptsForHousehold,
  getAllSettlementsForHousehold,
  getCurrentHouseholdId,
  insertSettlement,
} from '../lib/database';
import {
  createHousehold,
  deleteHousehold,
  getHouseholdMembers,
  getUserMemberships,
  renameHousehold,
} from '../lib/cloudSync';
import { clearBudgetsForHousehold, getCurrency } from '../lib/secureStorage';
import { computeMemberBalances, type MemberBalance } from '../lib/balances';
import { formatCurrency, type CurrencyCode } from '../lib/currency';
import { v4 as uuidv4 } from 'uuid';

/**
 * Multi-household switcher. Lists every household the signed-in user
 * belongs to (lib/AuthContext's `memberships`), lets them switch the
 * active one, create a new one, (owner-only) name a legacy household
 * that predates this feature and never got a real name, or (owner-
 * only) swipe a row left to delete it entirely. Switching is blocked
 * while `editInProgress` is true (an unsaved scan/edit screen is
 * open) — see app/(tabs)/scan.tsx and app/edit/[id].tsx, which set
 * that flag on mount/unmount.
 */
export default function HouseholdsScreen() {
  const theme = useTheme();
  const styles = useHouseholdsStyles();
  const router = useRouter();
  const toast = useToast();
  const { user, memberships, refreshMemberships, setActiveHousehold, editInProgress } = useAuth();

  const [loading, setLoading] = useState(true);
  const [switchingTo, setSwitchingTo] = useState<string | null>(null);
  // Which name-entry form (if any) is open. "create" and "rename" are
  // mutually exclusive by construction — there's no way to enter one
  // without leaving the other — since both forms use autoFocus and
  // showing both at once for the same-sorted household created a tap-
  // the-wrong-button trap (QA bug M-01): type a new name, hit what
  // looks like "Save" but is actually "Create" a few px above it, and
  // you get a brand-new empty household instead of a rename.
  // "rename" carries which household id right on the state itself —
  // there's no separate renamingHid to forget to clear/keep in sync,
  // and no way to end up in a "rename" state without a target id.
  const [activeForm, setActiveForm] = useState<'none' | 'create' | { hid: string }>('none');
  const [newName, setNewName] = useState('');
  const [savingNew, setSavingNew] = useState(false);
  const [renameValue, setRenameValue] = useState('');
  const [savingRename, setSavingRename] = useState(false);
  const [deletingHid, setDeletingHid] = useState<string | null>(null);
  const [currency, setCurrency] = useState<CurrencyCode>('USD');
  const swipeableRefs = useRef<Record<string, Swipeable | null>>({});

  useFocusEffect(
    useCallback(() => {
      getCurrency().then((c) => {
        if (c) setCurrency(c as CurrencyCode);
      });
    }, []),
  );

  useFocusEffect(
    useCallback(() => {
      let mounted = true;
      (async () => {
        await refreshMemberships();
        if (mounted) setLoading(false);
      })();
      return () => {
        mounted = false;
      };
    }, [refreshMemberships]),
  );

  const activeHouseholdId = getCurrentHouseholdId();

  const switchTo = async (householdId: string) => {
    if (householdId === activeHouseholdId) return;
    if (editInProgress) {
      toast.show({
        kind: 'error',
        message: 'Finish or discard your in-progress expense before switching households.',
      });
      return;
    }
    setSwitchingTo(householdId);
    try {
      await setActiveHousehold(householdId);
      toast.show({ kind: 'success', message: 'Switched household' });
    } catch (e) {
      toast.show({ kind: 'error', message: (e as Error)?.message ?? "Couldn't switch household" });
    } finally {
      setSwitchingTo(null);
    }
  };

  const saveNewHousehold = async () => {
    const name = newName.trim();
    if (!name || !user?.uid || savingNew) return;
    setSavingNew(true);
    try {
      const res = await createHousehold({ uid: user.uid, name });
      if (!res.ok) {
        toast.show({ kind: 'error', message: res.reason || "Couldn't create household" });
        return;
      }
      await setActiveHousehold(res.householdId);
      // Functional updater, not a bare 'none' — if the user has since
      // switched to the rename form while this create call was in
      // flight, don't stomp on it.
      setActiveForm((current) => (current === 'create' ? 'none' : current));
      setNewName('');
      toast.show({ kind: 'success', message: `${name} created` });
    } catch (e) {
      toast.show({ kind: 'error', message: (e as Error)?.message ?? "Couldn't create household" });
    } finally {
      setSavingNew(false);
    }
  };

  const startRename = (hid: string, current: string) => {
    setActiveForm({ hid });
    setNewName('');
    setRenameValue(current);
  };

  const saveRename = async () => {
    const name = renameValue.trim();
    const renamingHid = typeof activeForm === 'object' ? activeForm.hid : null;
    if (!name || !renamingHid || !user?.uid || savingRename) return;
    setSavingRename(true);
    try {
      const res = await renameHousehold({ householdId: renamingHid, name, uid: user.uid });
      if (!res.ok) {
        toast.show({ kind: 'error', message: res.reason || "Couldn't rename household" });
        return;
      }
      // Functional updater — see the matching comment in
      // saveNewHousehold above.
      setActiveForm((current) =>
        typeof current === 'object' && current.hid === renamingHid ? 'none' : current,
      );
      await refreshMemberships();
    } catch (e) {
      toast.show({ kind: 'error', message: (e as Error)?.message ?? "Couldn't rename household" });
    } finally {
      setSavingRename(false);
    }
  };

  // Owner-only, triggered by swiping a row left. Checks THAT household
  // (not necessarily the active one) for unsettled balances first — if
  // any exist, the confirmation offers to auto-settle them before
  // permanently deleting. Auto-settle only actually records a
  // settlement when this IS the active household (insertSettlement
  // stamps whatever household is currently active locally, so doing
  // it for a non-active target would mis-attribute the settlement) —
  // for a non-active target the balances just evaporate along with
  // the rest of the household's data, which the confirmation copy
  // makes clear either way.
  const confirmDelete = async (
    householdId: string,
    label: string,
    isActive: boolean,
  ) => {
    if (!user?.uid || deletingHid) return;
    swipeableRefs.current[householdId]?.close();
    const members = await getHouseholdMembers({ householdId, currentUid: user.uid });
    const [receipts, settlements] = await Promise.all([
      getAllReceiptsForHousehold(householdId),
      getAllSettlementsForHousehold(householdId),
    ]);
    const memberArr = members ?? [];
    const pending = computeMemberBalances(receipts, settlements, user.uid, memberArr).filter(
      (b) => Math.abs(b.netUsd) > 0.005,
    );
    const otherCount = memberArr.filter((mm) => mm.uid !== user.uid).length;
    const otherMembersWarning =
      otherCount > 0
        ? ` The other ${otherCount} member${otherCount === 1 ? '' : 's'} will lose access to it.`
        : '';
    if (pending.length > 0) {
      const total = pending.reduce((sum, b) => sum + Math.abs(b.netUsd), 0);
      Alert.alert(
        'Unsettled balances',
        `"${label}" has ${formatCurrency(total, currency)} in unsettled balances. Deleting it will auto-settle ${
          pending.length === 1 ? 'it' : 'them'
        } and permanently delete every receipt and settlement in it.${otherMembersWarning} This can't be undone.`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Settle & Delete',
            style: 'destructive',
            onPress: () => performDelete(householdId, pending, isActive),
          },
        ],
      );
    } else {
      Alert.alert(
        `Delete "${label}"?`,
        `This permanently deletes every receipt and settlement in it.${otherMembersWarning} This can't be undone.`,
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Delete', style: 'destructive', onPress: () => performDelete(householdId, [], isActive) },
        ],
      );
    }
  };

  const performDelete = async (
    householdId: string,
    pending: MemberBalance[],
    isActive: boolean,
  ) => {
    if (!user?.uid || deletingHid) return;
    setDeletingHid(householdId);
    try {
      if (isActive) {
        for (const b of pending) {
          const fromUid = b.netUsd > 0 ? b.memberUid : user.uid;
          const toUid = b.netUsd > 0 ? user.uid : b.memberUid;
          await insertSettlement({
            id: uuidv4(),
            fromUid,
            toUid,
            amountUsd: Math.abs(b.netUsd),
            createdAt: new Date().toISOString(),
          });
        }
      }
      const res = await deleteHousehold({ householdId, uid: user.uid });
      if (!res.ok) {
        toast.show({ kind: 'error', message: res.reason || "Couldn't delete household" });
        return;
      }
      await deleteAllRowsForHousehold(householdId);
      await clearBudgetsForHousehold(householdId);
      if (isActive) {
        const remaining = (await getUserMemberships(user.uid)).filter(
          (r) => r.householdId !== householdId,
        );
        let nextHid: string;
        if (remaining.length > 0) {
          nextHid = (remaining.find((r) => r.isDefault) ?? remaining[0]).householdId;
        } else {
          const created = await createHousehold({ uid: user.uid, name: 'My Household' });
          if (!created.ok) {
            toast.show({
              kind: 'error',
              message: "Household deleted, but couldn't set up a new one — restart the app.",
            });
            return;
          }
          nextHid = created.householdId;
        }
        await setActiveHousehold(nextHid);
      }
      await refreshMemberships();
      toast.show({ kind: 'success', message: 'Household deleted' });
    } catch (e) {
      toast.show({ kind: 'error', message: (e as Error)?.message ?? "Couldn't delete household" });
    } finally {
      setDeletingHid(null);
    }
  };

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
      <ModalHeader
        title="Households"
        onBack={() => router.back()}
        rightActions={[
          {
            icon: 'add',
            onPress: () => {
              setActiveForm((f) => (f === 'create' ? 'none' : 'create'));
            },
            accessibilityLabel: 'Create household',
          },
        ]}
      />

      {activeForm === 'create' && (
        <View style={styles.createRow}>
          <TextInput
            value={newName}
            onChangeText={setNewName}
            placeholder="Household name"
            placeholderTextColor={theme.colors.textMuted}
            style={styles.input}
            autoFocus
          />
          <Pressable
            onPress={saveNewHousehold}
            disabled={savingNew || !newName.trim()}
            style={[styles.saveBtn, (savingNew || !newName.trim()) && styles.saveBtnDisabled]}
          >
            <Text style={styles.saveBtnText}>{savingNew ? 'Creating…' : 'Create'}</Text>
          </Pressable>
        </View>
      )}

      {!loading && memberships.length === 0 ? (
        <EmptyState
          icon="home-outline"
          title="No households yet"
          description="Tap + to create your first household."
        />
      ) : (
        <ScrollView contentContainerStyle={styles.scroll}>
          {memberships.map((m) => {
            const isActive = m.householdId === activeHouseholdId;
            const isRenaming = typeof activeForm === 'object' && activeForm.hid === m.householdId;
            const label = m.name || 'Unnamed household';
            const card = (
              <View style={[styles.card, isActive && styles.cardActive]}>
                {isRenaming ? (
                  <View style={styles.renameRow}>
                    <TextInput
                      value={renameValue}
                      onChangeText={setRenameValue}
                      placeholder="Household name"
                      placeholderTextColor={theme.colors.textMuted}
                      style={styles.input}
                      autoFocus
                    />
                    <Pressable
                      onPress={saveRename}
                      disabled={savingRename || !renameValue.trim()}
                      style={[styles.saveBtn, (savingRename || !renameValue.trim()) && styles.saveBtnDisabled]}
                    >
                      <Text style={styles.saveBtnText}>{savingRename ? 'Saving…' : 'Save'}</Text>
                    </Pressable>
                  </View>
                ) : (
                  <Pressable
                    style={styles.row}
                    onPress={() => switchTo(m.householdId)}
                    disabled={switchingTo !== null}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={styles.name} numberOfLines={1}>{label}</Text>
                      <Text style={styles.meta}>
                        {m.memberCount} {m.memberCount === 1 ? 'member' : 'members'} ·{' '}
                        {m.role === 'owner' ? 'Owner' : 'Member'}
                      </Text>
                      {!m.name && m.role === 'owner' && (
                        <Pressable onPress={() => startRename(m.householdId, '')} hitSlop={4}>
                          <Text style={styles.nameItLink}>Name it</Text>
                        </Pressable>
                      )}
                    </View>
                    {switchingTo === m.householdId ? (
                      <ActivityIndicator color={theme.colors.accent} />
                    ) : isActive ? (
                      <View style={styles.activeBadge}>
                        <Text style={styles.activeBadgeText}>Active</Text>
                      </View>
                    ) : null}
                  </Pressable>
                )}
              </View>
            );

            if (m.role !== 'owner' || isRenaming) {
              return <View key={m.householdId}>{card}</View>;
            }

            return (
              <Swipeable
                key={m.householdId}
                ref={(ref) => {
                  swipeableRefs.current[m.householdId] = ref;
                }}
                renderRightActions={() => (
                  <Pressable
                    style={styles.deleteAction}
                    onPress={() => confirmDelete(m.householdId, label, isActive)}
                    disabled={deletingHid !== null}
                  >
                    {deletingHid === m.householdId ? (
                      <ActivityIndicator color="#fff" />
                    ) : (
                      <>
                        <Ionicons name="trash" size={20} color="#fff" />
                        <Text style={styles.deleteActionText}>Delete</Text>
                      </>
                    )}
                  </Pressable>
                )}
              >
                {card}
              </Swipeable>
            );
          })}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function useHouseholdsStyles() {
  return useStyles((theme) => ({
    screen: { flex: 1, backgroundColor: theme.colors.background },
    scroll: {
      paddingHorizontal: theme.spacing.lg,
      paddingTop: theme.spacing.lg,
      paddingBottom: theme.spacing.xl,
    },
    createRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: theme.spacing.lg,
      paddingTop: theme.spacing.md,
      gap: theme.spacing.sm,
    },
    renameRow: {
      flexDirection: 'row',
      alignItems: 'center',
      padding: theme.spacing.md,
      gap: theme.spacing.sm,
    },
    input: {
      flex: 1,
      color: theme.colors.textPrimary,
      backgroundColor: theme.colors.surfaceHigh,
      borderRadius: theme.radius.sm,
      borderWidth: 1,
      borderColor: theme.colors.border,
      paddingHorizontal: 12,
      paddingVertical: 10,
      fontSize: theme.font.md,
    },
    saveBtn: {
      backgroundColor: theme.colors.accent,
      borderRadius: theme.radius.sm,
      paddingHorizontal: 14,
      paddingVertical: 10,
    },
    saveBtnDisabled: {
      opacity: 0.5,
    },
    saveBtnText: {
      color: '#fff',
      fontFamily: theme.fonts.display.bold,
      fontSize: theme.font.sm,
    },
    card: {
      backgroundColor: theme.colors.surface,
      borderRadius: theme.radius.lg,
      borderWidth: 1,
      borderColor: theme.colors.border,
      marginBottom: theme.spacing.sm,
    },
    cardActive: {
      borderColor: theme.colors.accent,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      padding: theme.spacing.md,
    },
    name: {
      color: theme.colors.textPrimary,
      fontFamily: theme.fonts.display.bold,
      fontSize: theme.font.md,
    },
    meta: {
      color: theme.colors.textMuted,
      fontSize: theme.font.sm,
      marginTop: 2,
    },
    nameItLink: {
      color: theme.colors.accent,
      fontFamily: theme.fonts.display.bold,
      fontSize: theme.font.sm,
      marginTop: 4,
    },
    activeBadge: {
      backgroundColor: theme.colors.accent,
      borderRadius: theme.radius.sm,
      paddingHorizontal: 10,
      paddingVertical: 4,
    },
    activeBadgeText: {
      color: '#fff',
      fontFamily: theme.fonts.display.bold,
      fontSize: theme.font.xs,
    },
    deleteAction: {
      backgroundColor: theme.colors.error,
      justifyContent: 'center',
      alignItems: 'center',
      width: 84,
      marginBottom: theme.spacing.sm,
      borderTopRightRadius: theme.radius.lg,
      borderBottomRightRadius: theme.radius.lg,
      gap: 2,
    },
    deleteActionText: {
      color: '#fff',
      fontFamily: theme.fonts.display.bold,
      fontSize: theme.font.xs,
    },
  }));
}
