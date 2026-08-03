import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Alert } from 'react-native';
import Constants from 'expo-constants';
import {
  AuthUser,
  configureGoogleSignIn,
  deleteCurrentAccount,
  getCurrentUser,
  onAuthStateChanged,
  signOutEverywhere,
  updateAuthDisplayName,
} from './auth';
import { Profile, getProfile, deleteProfile, saveProfile } from './profile';
import {
  bootstrapHouseholdId,
  deleteAllReceipts,
  getAllReceipts,
  getCurrentHouseholdId,
  setCurrentHouseholdId,
  setCurrentUserId,
} from './database';
import {
  acceptInvite,
  acceptPhoneInviteIfAny,
  declineInvite,
  deleteCloudUserData,
  ensureHouseholdForUser,
  ensureMembershipForCurrentHousehold,
  getPendingInviteForEmail,
  getUserMemberships,
  migrateLocalReceiptsToCloud,
  persistActiveHouseholdId,
  subscribeToHouseholdBudgets,
  subscribeToHouseholdReceipts,
  subscribeToHouseholdSettlements,
  syncPushTokenToCloud,
  type HouseholdMembership,
} from './cloudSync';
import {
  getOnboardingSeen,
  migrateLegacyBudgetsToHousehold,
  setOnboardingSeen as persistOnboardingSeen,
  resetAllSecureStorage,
} from './secureStorage';
import { processRecurringReceipts } from './recurring';
import { registerForPushNotificationsAsync } from './notifications';

type AuthState = {
  initializing: boolean;
  user: AuthUser | null;
  profile: Profile | null;
  onboardingSeen: boolean;
  markOnboardingSeen: () => Promise<void>;
  /** Save the local profile (name) right after signup / first Google login. */
  ensureProfile: (firstName: string, lastName: string) => Promise<void>;
  /** Edit the name on an existing profile — used by the profile edit page. */
  updateProfileName: (firstName: string, lastName: string) => Promise<void>;
  refreshProfile: () => Promise<void>;
  /** Re-pull the Firebase Auth user object (e.g. after updateAuthDisplayName). */
  refreshUser: () => void;
  signOut: () => Promise<void>;
  deleteAccount: () => Promise<void>;
  /** Every household the signed-in user belongs to (multi-household
   *  support). Refreshed after sign-in and after any switch/create/leave. */
  memberships: HouseholdMembership[];
  /** Switches the active household: tears down the old Firestore
   *  listeners, backfills local rows for the new household, persists
   *  the choice to `users/{uid}.householdId`, and resubscribes. Blocked
   *  by the caller (Households screen) while `editInProgress` is true. */
  setActiveHousehold: (householdId: string) => Promise<void>;
  refreshMemberships: () => Promise<void>;
  /** Set by scan/edit screens while an unsaved receipt is in progress,
   *  so the Households switcher can block switching mid-edit — saving
   *  under the wrong household would otherwise be silently possible. */
  editInProgress: boolean;
  setEditInProgress: (inProgress: boolean) => void;
};

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [initializing, setInitializing] = useState(true);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [profile, setProfileState] = useState<Profile | null>(null);
  const [profileLoaded, setProfileLoaded] = useState(false);
  const [onboardingSeen, setOnboardingSeenState] = useState(false);
  const [memberships, setMemberships] = useState<HouseholdMembership[]>([]);
  const [editInProgress, setEditInProgress] = useState(false);

  useEffect(() => {
    const webClientId =
      (Constants.expoConfig?.extra as { googleWebClientId?: string } | undefined)?.googleWebClientId ??
      process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID;
    if (webClientId) {
      configureGoogleSignIn(webClientId);
    }
  }, []);

  useEffect(() => {
    let mounted = true;
    (async () => {
      const seen = await getOnboardingSeen();
      if (!mounted) return;
      setOnboardingSeenState(seen);
    })();
    return () => {
      mounted = false;
    };
  }, []);

  // Load (or clear) the local profile whenever the signed-in user changes.
  useEffect(() => {
    let mounted = true;
    if (!user) {
      setProfileState(null);
      setProfileLoaded(true);
      return;
    }
    setProfileLoaded(false);
    (async () => {
      try {
        const p = await getProfile(user.uid);
        if (!mounted) return;
        setProfileState(p);
        // Backfill for accounts created before Firebase Auth displayName
        // was set at signup — without this, an existing user's OTHER
        // devices (no local profile row) keep showing "Signed in".
        if (p && !user.displayName) {
          const fullName = `${p.firstName} ${p.lastName}`.trim();
          if (fullName) {
            try {
              await updateAuthDisplayName(fullName);
              if (mounted) setUser(getCurrentUser());
            } catch {
              // Best-effort — retried on next app open.
            }
          }
        }
      } finally {
        if (mounted) setProfileLoaded(true);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [user?.uid]);

  // Phase 3: track the active receipts listener so we can tear it down
  // on sign-out / household change before re-subscribing.
  const receiptsUnsubRef = useRef<(() => void) | null>(null);
  // Same for the settlements listener ("settle up" ledger).
  const settlementsUnsubRef = useRef<(() => void) | null>(null);
  // Same for the household budgets listener (Settings' category/recurring
  // budget amounts + alerts toggle, mirrored onto the household doc).
  const budgetsUnsubRef = useRef<(() => void) | null>(null);
  const tearDownReceiptsListener = useCallback(() => {
    if (receiptsUnsubRef.current) {
      receiptsUnsubRef.current();
      receiptsUnsubRef.current = null;
    }
    if (settlementsUnsubRef.current) {
      settlementsUnsubRef.current();
      settlementsUnsubRef.current = null;
    }
    if (budgetsUnsubRef.current) {
      budgetsUnsubRef.current();
      budgetsUnsubRef.current = null;
    }
  }, []);

  const refreshMemberships = useCallback(async (uid?: string) => {
    const targetUid = uid ?? user?.uid;
    if (!targetUid) {
      setMemberships([]);
      return;
    }
    const list = await getUserMemberships(targetUid);
    setMemberships(list);
  }, [user?.uid]);

  /** The single place that switches "the active household," used by
   *  sign-in bootstrap, invite/phone-invite accept, and the Households
   *  screen's manual switcher. Tears down old listeners, backfills this
   *  user's rows for the new household locally, persists the choice to
   *  Firestore, then resubscribes.
   *
   *  Takes an explicit uid (rather than reading `user` state) because
   *  it's called from the sign-in effect in the SAME tick as
   *  `setUser(u)` — React state hasn't re-rendered yet at that point,
   *  so a closure over `user?.uid` would still see the PREVIOUS user
   *  (null, on a fresh sign-in) and silently no-op the very first
   *  bootstrap. */
  const runHouseholdSwitch = useCallback(
    async (uid: string, householdId: string) => {
      tearDownReceiptsListener();
      await bootstrapHouseholdId(uid, householdId);
      await Promise.all([
        persistActiveHouseholdId(uid, householdId),
        migrateLegacyBudgetsToHousehold(householdId),
        ensureMembershipForCurrentHousehold(uid, householdId),
      ]);
      const unsubReceipts = subscribeToHouseholdReceipts(householdId, uid);
      if (unsubReceipts) receiptsUnsubRef.current = unsubReceipts;
      const unsubSettlements = subscribeToHouseholdSettlements(householdId, uid);
      if (unsubSettlements) settlementsUnsubRef.current = unsubSettlements;
      const unsubBudgets = subscribeToHouseholdBudgets(householdId);
      if (unsubBudgets) budgetsUnsubRef.current = unsubBudgets;
      await refreshMemberships(uid);
    },
    [tearDownReceiptsListener, refreshMemberships],
  );

  /** Public, state-aware wrapper for the Households screen and other
   *  consumers of useAuth() that only have the CURRENT signed-in user
   *  in scope (not a fresh uid from an auth-state callback). */
  const setActiveHousehold = useCallback(
    async (householdId: string) => {
      if (!user?.uid) return;
      await runHouseholdSwitch(user.uid, householdId);
    },
    [user?.uid, runHouseholdSwitch],
  );

  // Guards the pending-invite check below so it fires once per signed-in
  // session rather than on every token-refresh echo of the auth listener
  // (onAuthStateChanged can re-fire for the same uid many times).
  const invitePromptedForUidRef = useRef<string | null>(null);
  // Same one-per-session guard for the phone-invite auto-accept check.
  const phoneInviteCheckedForUidRef = useRef<string | null>(null);
  // Same one-per-session guard for the recurring-expense processor.
  const recurringProcessedForUidRef = useRef<string | null>(null);

  const checkPendingInvite = useCallback(
    (u: AuthUser) => {
      if (!u.email) return;
      if (invitePromptedForUidRef.current === u.uid) return;
      invitePromptedForUidRef.current = u.uid;
      getPendingInviteForEmail(u.email)
        .then((invite) => {
          if (!invite) return;
          const inviterLabel = invite.invitedByName || invite.invitedByEmail || 'Someone';
          Alert.alert(
            'Household invite',
            `${inviterLabel} invited you to join their household${
              invite.householdName ? ` "${invite.householdName}"` : ''
            }.`,
            [
              {
                text: 'Decline',
                style: 'cancel',
                onPress: () => {
                  declineInvite({ invite }).catch(() => {
                    // Best-effort — a failed decline just leaves the
                    // invite pending for next launch.
                  });
                },
              },
              {
                text: 'Accept',
                onPress: async () => {
                  try {
                    const res = await acceptInvite({ invite, uid: u.uid });
                    if (!res.ok) return;
                    await runHouseholdSwitch(u.uid, res.newHouseholdId);
                    Alert.alert('Joined household', `You're now part of ${inviterLabel}'s household.`);
                  } catch {
                    // Cloud sync is optional-by-design throughout this
                    // codebase — a failed accept just leaves the invite
                    // pending for the user to retry.
                  }
                },
              },
            ],
          );
        })
        .catch(() => {
          // No pending invite / lookup failed — skip silently.
        });
    },
    [runHouseholdSwitch],
  );

  // A signed-in user's verified phone number may have been invited to a
  // household (by an existing member adding a contact, or by SMS before
  // they even signed up — lib/cloudSync.ts's addHouseholdMemberByPhone
  // always writes a phoneInvites/{e164} doc regardless of match). Per
  // the user's explicit decision, this auto-joins with NO confirm
  // prompt (unlike checkPendingInvite's email flow above) — the join
  // itself is a self-write the invitee's own client performs, so it
  // stays within the existing security-rule model instead of needing a
  // new rule for one user writing another's account.
  const checkPendingPhoneInvite = useCallback(
    async (u: AuthUser) => {
      if (phoneInviteCheckedForUidRef.current === u.uid) return;
      phoneInviteCheckedForUidRef.current = u.uid;
      try {
        const p = await getProfile(u.uid);
        if (!p?.phone || !p.phoneVerified) return;
        const result = await acceptPhoneInviteIfAny(u.uid, p.phone);
        if (!result.joined || !result.householdId) return;
        await runHouseholdSwitch(u.uid, result.householdId);
      } catch {
        // Best-effort — a failed check just leaves the invite pending
        // for the next sign-in.
      }
    },
    [runHouseholdSwitch],
  );

  useEffect(() => {
    const unsub = onAuthStateChanged(async (u) => {
      setUser(u);
      setInitializing(false);
      setCurrentUserId(u?.uid ?? null).catch(() => {
        // setCurrentUserId is intentionally tolerant of pre-migration
        // schemas; any error here is non-fatal.
      });

      tearDownReceiptsListener();

      if (u?.uid && recurringProcessedForUidRef.current !== u.uid) {
        recurringProcessedForUidRef.current = u.uid;
        // setCurrentUserId (above) sets the module-level uid
        // synchronously before its own async backfill runs, so it's
        // already safe to read here despite not being awaited.
        processRecurringReceipts().catch(() => {
          // Best-effort — a failed run just leaves any due occurrences
          // to be generated on the next app open instead.
        });
      }

      if (u?.uid) {
        // Silent household bootstrap so split/reports have a real (if
        // solo) household to read from, and receipt photos sync across
        // this user's own devices.
        const hid = await ensureHouseholdForUser({
          uid: u.uid,
          email: u.email,
          displayName: u.displayName,
        });
        if (hid) {
          await runHouseholdSwitch(u.uid, hid);
          void migrateLocalReceiptsToCloud({
            uid: u.uid,
            householdId: hid,
            loadAllReceipts: getAllReceipts,
          });

          // Refresh this device's push token on every sign-in — only
          // does anything if notification permission is ALREADY
          // granted (never prompts here; the explicit ask lives in
          // Settings' "Budget alerts" toggle). Keeps the token current
          // across reinstalls/rotations without needing its own UI.
          void registerForPushNotificationsAsync().then((token) => {
            if (token) void syncPushTokenToCloud(u.uid, token);
          });

          // A signed-in user with a real household may have a pending
          // invite waiting for their email (e.g. a household-mate
          // invited them before they ever signed up). Surface it once
          // per session.
          checkPendingInvite(u);
          void checkPendingPhoneInvite(u);
        } else {
          setCurrentHouseholdId(null);
          setMemberships([]);
        }
      } else {
        setCurrentHouseholdId(null);
        setMemberships([]);
        invitePromptedForUidRef.current = null;
        phoneInviteCheckedForUidRef.current = null;
      }
    });
    return unsub;
  }, [checkPendingInvite, checkPendingPhoneInvite, tearDownReceiptsListener, runHouseholdSwitch]);

  const refreshProfile = useCallback(async () => {
    if (!user) {
      setProfileState(null);
      return;
    }
    const p = await getProfile(user.uid);
    setProfileState(p);
  }, [user?.uid]);

  const value = useMemo<AuthState>(
    () => ({
      initializing: initializing || (user !== null && !profileLoaded),
      user,
      profile,
      onboardingSeen,
      markOnboardingSeen: async () => {
        await persistOnboardingSeen();
        setOnboardingSeenState(true);
      },
      ensureProfile: async (firstName: string, lastName: string) => {
        if (!user) return;
        const existing = await getProfile(user.uid);
        if (existing) return;
        const p = await saveProfile(user.uid, { firstName, lastName }, null);
        setProfileState(p);
        try {
          await updateAuthDisplayName(`${firstName} ${lastName}`.trim());
          setUser(getCurrentUser());
        } catch {
          // Best-effort — local profile already has the name; this just
          // means it won't show up as `user.displayName` on other devices.
        }
      },
      updateProfileName: async (firstName: string, lastName: string) => {
        if (!user) return;
        const existing = await getProfile(user.uid);
        const p = await saveProfile(user.uid, { firstName, lastName }, existing);
        setProfileState(p);
        try {
          await updateAuthDisplayName(`${firstName} ${lastName}`.trim());
          setUser(getCurrentUser());
        } catch {
          // Best-effort — local profile already has the name.
        }
      },
      refreshProfile,
      refreshUser: () => setUser(getCurrentUser()),
      signOut: async () => {
        await signOutEverywhere();
      },
      deleteAccount: async () => {
        const uid = user?.uid;
        if (!uid) return;
        // Wipe CLOUD data first while we still have an authenticated
        // Firebase token — deleteCurrentAccount() invalidates it.
        const householdId = getCurrentHouseholdId();
        try {
          await deleteCloudUserData({
            uid,
            householdId,
            email: user?.email ?? null,
          });
        } catch {
          // Even on cloud-cleanup failure we proceed with local + auth
          // deletion — any orphaned cloud docs can be scrubbed later.
        }
        await Promise.all([deleteAllReceipts(), deleteProfile(uid)]);
        await resetAllSecureStorage();
        setOnboardingSeenState(false);
        await deleteCurrentAccount();
        // onAuthStateChanged will fire with null, clearing user + profile.
      },
      memberships,
      setActiveHousehold,
      refreshMemberships: () => refreshMemberships(),
      editInProgress,
      setEditInProgress,
    }),
    [
      initializing,
      user,
      profile,
      profileLoaded,
      onboardingSeen,
      refreshProfile,
      memberships,
      setActiveHousehold,
      refreshMemberships,
      editInProgress,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
