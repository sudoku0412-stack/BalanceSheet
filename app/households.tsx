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
  // Which name-entry form (if any) is open, and everything about it
  // (its typed value, whether it's mid-save) lives on ONE state value
  // instead of several separately-toggled booleans/strings — so a
  // save's `saving` flag can never end up describing a DIFFERENT
  // household's form, and there's no separate hid/value/saving to
  // forget to clear/keep in sync with which mode is active. "create"
  // and "rename" are mutually exclusive by construction — there's no
  // way to enter one without leaving the other — since both forms use
  // autoFocus and showing both at once for the same-sorted household
  // created a tap-the-wrong-button trap (QA bug M-01): type a new
  // name, hit what looks like "Save" but is actually "Create" a few
  // px above it, and you get a brand-new empty household instead of a
  // rename.
  const [form, setForm] = useState<
    | { mode: 'none' }
    | { mode: 'create'; value: string; saving: boolean }
    | { mode: 'rename'; hid: string; value: string; saving: boolean }
  >({ mode: 'none' });
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

  // Bounds a request so a dropped connection or backend hang can't
  // leave `form.saving` stuck true forever — which would otherwise
  // permanently disable the "+" toggle and every "Name it" link (see
  // formBusy) with no error and no way to recover short of leaving
  // the screen.
  const REQUEST_TIMEOUT_MS = 15000;
  function withTimeout<T>(promise: Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("Request timed out — check your connection and try again.")),
        REQUEST_TIMEOUT_MS,
      );
      promise.then(
        (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        (err) => {
          clearTimeout(timer);
          reject(err);
        },
      );
    });
  }

  const saveNewHousehold = async () => {
    if (form.mode !== 'create') return;
    const name = form.value.trim();
    if (!name || !user?.uid || form.saving) return;
    setForm({ mode: 'create', value: form.value, saving: true });
    try {
      const res = await withTimeout(createHousehold({ uid: user.uid, name }));
      if (!res.ok) {
        toast.show({ kind: 'error', message: res.reason || "Couldn't create household" });
        return;
      }
      await setActiveHousehold(res.householdId);
      setForm({ mode: 'none' });
      toast.show({ kind: 'success', message: `${name} created` });
    } catch (e) {
      toast.show({ kind: 'error', message: (e as Error)?.message ?? "Couldn't create household" });
    } finally {
      setForm((f) => (f.mode === 'create' ? { ...f, saving: false } : f));
    }
  };

  // Entry points into either form (this, the header "+" toggle below,
  // and the per-row "Name it" link) are all disabled while a save is
  // in flight (see formBusy) — so by the time saveNewHousehold/
  // saveRename's success path runs, `form` can only be what THIS call
  // set it to; nothing else could have changed it in the meantime.
  const startRename = (hid: string, current: string) => {
    setForm({ mode: 'rename', hid, value: current, saving: false });
  };

  const saveRename = async () => {
    if (form.mode !== 'rename') return;
    const { hid, value } = form;
    const name = value.trim();
    if (!name || !user?.uid || form.saving) return;
    setForm({ mode: 'rename', hid, value, saving: true });
    try {
      const res = await withTimeout(renameHousehold({ householdId: hid, name, uid: user.uid }));
      if (!res.ok) {
        toast.show({ kind: 'error', message: res.reason || "Couldn't rename household" });
        return;
      }
      setForm({ mode: 'none' });
      await refreshMemberships();
    } catch (e) {
      toast.show({ kind: 'error', message: (e as Error)?.message ?? "Couldn't rename household" });
    } finally {
      setForm((f) => (f.mode === 'rename' ? { ...f, saving: false } : f));
    }
  };

  // Shared across both forms — disables the header "+" toggle and
  // every row's "Name it" link while either form's save is in flight,
  // so the user can't switch targets mid-save.
  const formBusy = form.mode !== 'none' && form.saving;

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
              setForm((f) => (f.mode === 'create' ? { mode: 'none' } : { mode: 'create', value: '', saving: false }));
            },
            disabled: formBusy,
            accessibilityLabel: 'Create household',
          },
        ]}
      />

      {form.mode === 'create' && (
        <View style={styles.createRow}>
          <TextInput
            value={form.value}
            onChangeText={(text) => setForm((f) => (f.mode === 'create' ? { ...f, value: text } : f))}
            placeholder="Household name"
            placeholderTextColor={theme.colors.textMuted}
            style={styles.input}
            autoFocus
          />
          <Pressable
            onPress={saveNewHousehold}
            disabled={form.saving || !form.value.trim()}
            style={[styles.saveBtn, (form.saving || !form.value.trim()) && styles.saveBtnDisabled]}
          >
            <Text style={styles.saveBtnText}>{form.saving ? 'Creating…' : 'Create'}</Text>
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
            const isRenaming = form.mode === 'rename' && form.hid === m.householdId;
            const label = m.name || 'Unnamed household';
            const card = (
              <View style={[styles.card, isActive && styles.cardActive]}>
                {isRenaming && form.mode === 'rename' ? (
                  <View style={styles.renameRow}>
                    <TextInput
                      value={form.value}
                      onChangeText={(text) =>
                        setForm((f) => (f.mode === 'rename' ? { ...f, value: text } : f))
                      }
                      placeholder="Household name"
                      placeholderTextColor={theme.colors.textMuted}
                      style={styles.input}
                      autoFocus
                    />
                    <Pressable
                      onPress={saveRename}
                      disabled={form.saving || !form.value.trim()}
                      style={[styles.saveBtn, (form.saving || !form.value.trim()) && styles.saveBtnDisabled]}
                    >
                      <Text style={styles.saveBtnText}>{form.saving ? 'Saving…' : 'Save'}</Text>
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
                        <Pressable
                          onPress={() => startRename(m.householdId, '')}
                          disabled={formBusy || deletingHid === m.householdId}
                          hitSlop={4}
                        >
                          <Text
                            style={[
                              styles.nameItLink,
                              (formBusy || deletingHid === m.householdId) && { opacity: 0.4 },
                            ]}
                          >
                            Name it
                          </Text>
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
