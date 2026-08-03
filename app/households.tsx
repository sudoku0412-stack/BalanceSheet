import React, { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ModalHeader } from '../components/ui/ModalHeader';
import { EmptyState } from '../components/ui/EmptyState';
import { useStyles, useTheme } from '../constants/theme';
import { useToast } from '../components/ui/Toast';
import { useAuth } from '../lib/AuthContext';
import { getCurrentHouseholdId } from '../lib/database';
import { createHousehold, renameHousehold } from '../lib/cloudSync';

/**
 * Multi-household switcher. Lists every household the signed-in user
 * belongs to (lib/AuthContext's `memberships`), lets them switch the
 * active one, create a new one, or (owner-only) name a legacy
 * household that predates this feature and never got a real name.
 * Switching is blocked while `editInProgress` is true (an unsaved
 * scan/edit screen is open) — see app/(tabs)/scan.tsx and
 * app/edit/[id].tsx, which set that flag on mount/unmount.
 */
export default function HouseholdsScreen() {
  const theme = useTheme();
  const styles = useHouseholdsStyles();
  const router = useRouter();
  const toast = useToast();
  const { user, memberships, refreshMemberships, setActiveHousehold, editInProgress } = useAuth();

  const [loading, setLoading] = useState(true);
  const [switchingTo, setSwitchingTo] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [savingNew, setSavingNew] = useState(false);
  const [renamingHid, setRenamingHid] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [savingRename, setSavingRename] = useState(false);

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
      setCreating(false);
      setNewName('');
      toast.show({ kind: 'success', message: `${name} created` });
    } catch (e) {
      toast.show({ kind: 'error', message: (e as Error)?.message ?? "Couldn't create household" });
    } finally {
      setSavingNew(false);
    }
  };

  const startRename = (hid: string, current: string) => {
    setRenamingHid(hid);
    setRenameValue(current);
  };

  const saveRename = async () => {
    const name = renameValue.trim();
    if (!name || !renamingHid || !user?.uid || savingRename) return;
    setSavingRename(true);
    try {
      const res = await renameHousehold({ householdId: renamingHid, name, uid: user.uid });
      if (!res.ok) {
        toast.show({ kind: 'error', message: res.reason || "Couldn't rename household" });
        return;
      }
      setRenamingHid(null);
      await refreshMemberships();
    } catch (e) {
      toast.show({ kind: 'error', message: (e as Error)?.message ?? "Couldn't rename household" });
    } finally {
      setSavingRename(false);
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
            onPress: () => setCreating((v) => !v),
            accessibilityLabel: 'Create household',
          },
        ]}
      />

      {creating && (
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
            const isRenaming = renamingHid === m.householdId;
            const label = m.name || 'Unnamed household';
            return (
              <View key={m.householdId} style={[styles.card, isActive && styles.cardActive]}>
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
  }));
}
