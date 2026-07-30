import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Alert } from 'react-native';
import Constants from 'expo-constants';
import {
  AuthUser,
  configureGoogleSignIn,
  deleteCurrentAccount,
  onAuthStateChanged,
  signOutEverywhere,
} from './auth';
import { Profile, getProfile, deleteProfile, saveProfile } from './profile';
import {
  deleteAllReceipts,
  getAllReceipts,
  getCurrentHouseholdId,
  setCurrentHouseholdId,
  setCurrentUserId,
} from './database';
import {
  acceptInvite,
  declineInvite,
  deleteCloudUserData,
  ensureHouseholdForUser,
  getPendingInviteForEmail,
  migrateLocalReceiptsToCloud,
  subscribeToHouseholdReceipts,
} from './cloudSync';
import { getOnboardingSeen, setOnboardingSeen as persistOnboardingSeen, resetAllSecureStorage } from './secureStorage';

type AuthState = {
  initializing: boolean;
  user: AuthUser | null;
  profile: Profile | null;
  onboardingSeen: boolean;
  markOnboardingSeen: () => Promise<void>;
  /** Save the local profile (name) right after signup / first Google login. */
  ensureProfile: (firstName: string, lastName: string) => Promise<void>;
  refreshProfile: () => Promise<void>;
  signOut: () => Promise<void>;
  deleteAccount: () => Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [initializing, setInitializing] = useState(true);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [profile, setProfileState] = useState<Profile | null>(null);
  const [profileLoaded, setProfileLoaded] = useState(false);
  const [onboardingSeen, setOnboardingSeenState] = useState(false);

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
  const tearDownReceiptsListener = useCallback(() => {
    if (receiptsUnsubRef.current) {
      receiptsUnsubRef.current();
      receiptsUnsubRef.current = null;
    }
  }, []);

  // Guards the pending-invite check below so it fires once per signed-in
  // session rather than on every token-refresh echo of the auth listener
  // (onAuthStateChanged can re-fire for the same uid many times).
  const invitePromptedForUidRef = useRef<string | null>(null);

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
                    setCurrentHouseholdId(res.newHouseholdId);
                    tearDownReceiptsListener();
                    const unsubReceipts = subscribeToHouseholdReceipts(
                      res.newHouseholdId,
                      u.uid,
                    );
                    if (unsubReceipts) receiptsUnsubRef.current = unsubReceipts;
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
    [tearDownReceiptsListener],
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

      if (u?.uid) {
        // Silent household bootstrap so split/reports have a real (if
        // solo) household to read from, and receipt photos sync across
        // this user's own devices.
        const hid = await ensureHouseholdForUser({
          uid: u.uid,
          email: u.email,
          displayName: u.displayName,
        });
        setCurrentHouseholdId(hid);
        if (hid) {
          void migrateLocalReceiptsToCloud({
            uid: u.uid,
            householdId: hid,
            loadAllReceipts: getAllReceipts,
          });
          const unsubReceipts = subscribeToHouseholdReceipts(hid, u.uid);
          if (unsubReceipts) receiptsUnsubRef.current = unsubReceipts;

          // A signed-in user with a real household may have a pending
          // invite waiting for their email (e.g. a household-mate
          // invited them before they ever signed up). Surface it once
          // per session.
          checkPendingInvite(u);
        }
      } else {
        setCurrentHouseholdId(null);
        invitePromptedForUidRef.current = null;
      }
    });
    return unsub;
  }, [checkPendingInvite, tearDownReceiptsListener]);

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
      },
      refreshProfile,
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
    }),
    [initializing, user, profile, profileLoaded, onboardingSeen, refreshProfile],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
