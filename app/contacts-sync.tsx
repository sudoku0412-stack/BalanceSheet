import React, { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Share, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ModalHeader } from '../components/ui/ModalHeader';
import { EmptyState } from '../components/ui/EmptyState';
import { useStyles, useTheme } from '../constants/theme';
import { useToast } from '../components/ui/Toast';
import { useAuth } from '../lib/AuthContext';
import { getCurrentHouseholdId } from '../lib/database';
import { getBudgetsSnapshot, type BudgetsSnapshot } from '../lib/secureStorage';
import { withTimeout } from '../lib/withTimeout';
import { inviteUserToHousehold } from '../lib/cloudSync';
import { addByPhone } from '../lib/phoneInvite';
import {
  isContactsSyncAvailable,
  readAllContacts,
  matchContacts,
  type DeviceContact,
  type MatchedContact,
} from '../lib/contactsSync';

const REQUEST_TIMEOUT_MS = 15000;

/**
 * Full contacts sync: reads every device contact with a phone or
 * email, matches each against phoneIndex/emailIndex, and splits them
 * into "On NestExpenseTracker" (tap to add straight to the household)
 * vs "Invite" (tap to send the join link via the OS share sheet).
 * Complements lib/contactPicker.ts's single-contact picker (still used
 * by Settings' "Add by phone contact") rather than replacing it.
 */
export default function ContactsSyncScreen() {
  const theme = useTheme();
  const styles = useContactsSyncStyles();
  const router = useRouter();
  const toast = useToast();
  const { user, profile, refreshMemberships } = useAuth();

  const [phase, setPhase] = useState<'idle' | 'loading' | 'done'>('idle');
  const [matched, setMatched] = useState<MatchedContact[]>([]);
  const [unmatched, setUnmatched] = useState<DeviceContact[]>([]);
  const [addedUids, setAddedUids] = useState<Set<string>>(new Set());
  const [busyId, setBusyId] = useState<string | null>(null);
  // Fetched once per sync run, not re-read on every row's tap — the
  // household's budgets don't change mid-session, so refetching per
  // tap (as the first version of this screen did) was pure wasted
  // SecureStore I/O for every add/invite action.
  const [budgets, setBudgets] = useState<BudgetsSnapshot | undefined>(undefined);

  const inviterName = profile ? `${profile.firstName} ${profile.lastName}`.trim() : null;

  const startSync = useCallback(async () => {
    if (!isContactsSyncAvailable()) {
      toast.show({
        kind: 'error',
        message: 'This app needs an update before contacts sync works — try again after updating.',
      });
      return;
    }
    const householdId = getCurrentHouseholdId();
    if (!householdId) return;
    setPhase('loading');
    try {
      const contacts = await readAllContacts();
      if (!contacts) {
        toast.show({ kind: 'error', message: 'Contacts permission was denied.' });
        setPhase('idle');
        return;
      }
      const [result, budgetsSnapshot] = await Promise.all([
        withTimeout(matchContacts(contacts), REQUEST_TIMEOUT_MS),
        getBudgetsSnapshot(householdId),
      ]);
      setMatched(result.matched);
      setUnmatched(result.unmatched);
      setBudgets(budgetsSnapshot);
      setPhase('done');
    } catch (e) {
      toast.show({ kind: 'error', message: (e as Error)?.message ?? "Couldn't read contacts" });
      setPhase('idle');
    }
  }, [toast]);

  const addMatched = async (item: MatchedContact) => {
    const householdId = getCurrentHouseholdId();
    if (!householdId || !user?.uid || busyId) return;
    setBusyId(item.contact.id);
    try {
      if (item.matchedVia === 'phone') {
        const res = await addByPhone({
          phoneE164: item.matchedValue,
          householdId,
          householdName: null,
          invitedByUid: user.uid,
          invitedByName: inviterName,
          budgets,
        });
        if (!res.ok) {
          toast.show({ kind: 'error', message: res.reason || "Couldn't add contact" });
          return;
        }
        if (!res.matched) {
          // matchContacts confirmed this phone at scan time, but the
          // account could've been deleted/unlinked since — fall back to
          // the same share-the-invite-text path inviteUnmatched uses,
          // instead of silently claiming success with nothing sent.
          setAddedUids((prev) => new Set(prev).add(item.uid));
          try {
            await Share.share({ message: res.inviteText });
          } catch {
            // User backed out of the share sheet — the invite doc is
            // already saved regardless, so it's not a failure.
          }
          toast.show({
            kind: 'success',
            message: `${item.contact.name} wasn't found — invite sent instead`,
          });
          return;
        }
        setAddedUids((prev) => new Set(prev).add(item.uid));
        await refreshMemberships();
        toast.show({ kind: 'success', message: `${item.displayName || item.contact.name} added` });
      } else {
        const res = await withTimeout(
          inviteUserToHousehold({
            email: item.matchedValue,
            householdId,
            invitedByUid: user.uid,
            invitedByEmail: user.email ?? null,
            invitedByName: inviterName,
            budgets,
          }),
          REQUEST_TIMEOUT_MS,
        );
        if (!res.ok) {
          toast.show({ kind: 'error', message: res.reason || "Couldn't invite contact" });
          return;
        }
        // Email accounts still require the invitee's own accept tap on
        // next sign-in (unlike phone) — see lib/cloudSync.ts's
        // inviteUserToHousehold / acceptInvite. They already have the
        // app, so no share sheet needed here.
        setAddedUids((prev) => new Set(prev).add(item.uid));
        toast.show({
          kind: 'success',
          message: `Invited ${item.displayName || item.contact.name} — they'll join once they open the app`,
        });
      }
    } catch (e) {
      toast.show({ kind: 'error', message: (e as Error)?.message ?? "Couldn't add contact" });
    } finally {
      setBusyId(null);
    }
  };

  const inviteUnmatched = async (contact: DeviceContact) => {
    const householdId = getCurrentHouseholdId();
    if (!householdId || !user?.uid || busyId) return;
    setBusyId(contact.id);
    try {
      if (contact.phones[0]) {
        const res = await addByPhone({
          phoneE164: contact.phones[0],
          householdId,
          householdName: null,
          invitedByUid: user.uid,
          invitedByName: inviterName,
          budgets,
        });
        if (!res.ok) {
          toast.show({ kind: 'error', message: res.reason || "Couldn't invite contact" });
          return;
        }
        if (res.matched) {
          // The contact turned out to already have an account (signed
          // up between the scan and this tap) — same auto-join path as
          // addMatched's phone branch, so refresh members and report
          // "added" rather than the generic invite-sent toast below.
          setUnmatched((prev) => prev.filter((c) => c.id !== contact.id));
          await refreshMemberships();
          toast.show({ kind: 'success', message: `${res.displayName || contact.name} added` });
          return;
        }
        try {
          await Share.share({ message: res.inviteText });
        } catch {
          // User backed out of the share sheet — the invite doc is
          // already saved regardless, so it's not a failure.
        }
      } else if (contact.emails[0]) {
        const res = await withTimeout(
          inviteUserToHousehold({
            email: contact.emails[0],
            householdId,
            invitedByUid: user.uid,
            invitedByEmail: user.email ?? null,
            invitedByName: inviterName,
            budgets,
          }),
          REQUEST_TIMEOUT_MS,
        );
        if (!res.ok) {
          toast.show({ kind: 'error', message: res.reason || "Couldn't invite contact" });
          return;
        }
        const inviterLabel = inviterName?.trim() || 'Someone';
        try {
          await Share.share({
            message: `${inviterLabel} invited you to split expenses on NestExpenseTracker. Install the app and sign in with this email to join.`,
          });
        } catch {
          // Same as above — the invite doc is saved either way.
        }
      }
      setUnmatched((prev) => prev.filter((c) => c.id !== contact.id));
      toast.show({ kind: 'success', message: `Invite sent to ${contact.name}` });
    } catch (e) {
      toast.show({ kind: 'error', message: (e as Error)?.message ?? "Couldn't invite contact" });
    } finally {
      setBusyId(null);
    }
  };

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
      <ModalHeader title="Add from contacts" onBack={() => router.back()} />

      {phase === 'idle' && (
        <EmptyState
          icon="people-outline"
          title="Find household members in your contacts"
          description="We'll check your contacts against NestExpenseTracker accounts — accounts get added directly, everyone else gets an invite link you send yourself."
          actionLabel="Scan contacts"
          onAction={startSync}
        />
      )}

      {phase === 'loading' && (
        <View style={styles.centered}>
          <ActivityIndicator color={theme.colors.accent} />
          <Text style={styles.loadingText}>Reading contacts…</Text>
        </View>
      )}

      {phase === 'done' && (
        <ScrollView contentContainerStyle={styles.scroll}>
          {matched.length === 0 && unmatched.length === 0 && (
            <Text style={styles.emptyText}>No contacts with a phone number or email found.</Text>
          )}

          {matched.length > 0 && (
            <>
              <Text style={styles.sectionHeader}>On NestExpenseTracker</Text>
              {matched.map((item) => {
                const added = addedUids.has(item.uid);
                const busy = busyId === item.contact.id;
                return (
                  <View key={item.contact.id} style={styles.row}>
                    <Text style={styles.name} numberOfLines={1}>
                      {item.displayName || item.contact.name}
                    </Text>
                    <Pressable
                      onPress={() => addMatched(item)}
                      disabled={added || busy}
                      style={[styles.actionBtn, (added || busy) && styles.actionBtnDisabled]}
                    >
                      {busy ? (
                        <ActivityIndicator size="small" color={theme.colors.accent} />
                      ) : (
                        <Text style={styles.actionText}>
                          {item.matchedVia === 'phone' ? (added ? 'Added' : 'Add') : added ? 'Invited' : 'Invite'}
                        </Text>
                      )}
                    </Pressable>
                  </View>
                );
              })}
            </>
          )}

          {unmatched.length > 0 && (
            <>
              <Text style={styles.sectionHeader}>Invite to NestExpenseTracker</Text>
              {unmatched.map((contact) => {
                const busy = busyId === contact.id;
                return (
                  <View key={contact.id} style={styles.row}>
                    <Text style={styles.name} numberOfLines={1}>
                      {contact.name}
                    </Text>
                    <Pressable
                      onPress={() => inviteUnmatched(contact)}
                      disabled={busy}
                      style={[styles.actionBtn, busy && styles.actionBtnDisabled]}
                    >
                      {busy ? (
                        <ActivityIndicator size="small" color={theme.colors.accent} />
                      ) : (
                        <Text style={styles.actionText}>Invite</Text>
                      )}
                    </Pressable>
                  </View>
                );
              })}
            </>
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function useContactsSyncStyles() {
  return useStyles((theme) => ({
    screen: { flex: 1, backgroundColor: theme.colors.background },
    centered: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: theme.spacing.sm },
    loadingText: { color: theme.colors.textMuted, fontSize: theme.font.sm },
    scroll: {
      paddingHorizontal: theme.spacing.lg,
      paddingTop: theme.spacing.lg,
      paddingBottom: theme.spacing.xl,
    },
    emptyText: {
      color: theme.colors.textMuted,
      fontSize: theme.font.sm,
      textAlign: 'center',
      marginTop: theme.spacing.xl,
    },
    sectionHeader: {
      color: theme.colors.textMuted,
      fontFamily: theme.fonts.display.bold,
      fontSize: theme.font.xs,
      textTransform: 'uppercase',
      marginTop: theme.spacing.lg,
      marginBottom: theme.spacing.sm,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: theme.colors.surface,
      borderRadius: theme.radius.lg,
      borderWidth: 1,
      borderColor: theme.colors.border,
      paddingHorizontal: theme.spacing.md,
      paddingVertical: theme.spacing.sm,
      marginBottom: theme.spacing.sm,
      gap: theme.spacing.sm,
    },
    name: {
      flex: 1,
      color: theme.colors.textPrimary,
      fontFamily: theme.fonts.display.bold,
      fontSize: theme.font.md,
    },
    actionBtn: {
      backgroundColor: theme.colors.accent,
      borderRadius: theme.radius.sm,
      paddingHorizontal: 14,
      paddingVertical: 8,
      minWidth: 64,
      alignItems: 'center',
    },
    actionBtnDisabled: {
      opacity: 0.5,
    },
    actionText: {
      color: '#fff',
      fontFamily: theme.fonts.display.bold,
      fontSize: theme.font.sm,
    },
  }));
}
