import auth, { FirebaseAuthTypes } from '@react-native-firebase/auth';
import {
  GoogleSignin,
  isErrorWithCode,
  isSuccessResponse,
  statusCodes,
} from '@react-native-google-signin/google-signin';

let googleConfigured = false;

export function configureGoogleSignIn(webClientId: string) {
  if (googleConfigured) return;
  GoogleSignin.configure({ webClientId, offlineAccess: false });
  googleConfigured = true;
}

export type AuthUser = FirebaseAuthTypes.User;
export type ConfirmationResult = FirebaseAuthTypes.ConfirmationResult;

export function onAuthStateChanged(cb: (user: AuthUser | null) => void) {
  return auth().onAuthStateChanged(cb);
}

export function getCurrentUser(): AuthUser | null {
  return auth().currentUser;
}

export async function signInWithEmail(email: string, password: string): Promise<AuthUser> {
  const cred = await auth().signInWithEmailAndPassword(email.trim(), password);
  return cred.user;
}

export async function signUpWithEmail(email: string, password: string): Promise<AuthUser> {
  const cred = await auth().createUserWithEmailAndPassword(email.trim(), password);
  return cred.user;
}

/**
 * Sets the Firebase Auth user's displayName — email/password signup never
 * sets this on its own, unlike Google sign-in. Without it, `user.displayName`
 * stays null on every OTHER device signed into the same account (the local
 * SQLite `profile` row with the real name only exists on the device that
 * originally signed up), so Settings falls back to "Signed in" there.
 */
export async function updateAuthDisplayName(displayName: string): Promise<void> {
  const current = auth().currentUser;
  if (!current || !displayName.trim()) return;
  await current.updateProfile({ displayName: displayName.trim() });
}

export async function signInAsGuest(): Promise<AuthUser> {
  const cred = await auth().signInAnonymously();
  return cred.user;
}

/**
 * Sends the reset email as a deep link back into THIS app (app/reset-
 * password.tsx handles the oobCode) instead of Firebase's own hosted
 * web page — handleCodeInApp:true + android/iOS settings makes it a
 * Universal/App Link the OS opens directly in the app when installed.
 * Android genuinely deep-links straight in (assetlinks.json is live).
 * iOS falls back to firebase-hosting/reset-password/index.html — no
 * apple-app-site-association file exists yet (needs a paid Apple
 * Developer account, not set up — see HANDOVER.md), so iOS opens
 * Safari first; that page offers a manual "Open in app" link via the
 * receipt-scanner:// custom scheme, which works without AASA.
 */
export async function sendPasswordReset(email: string): Promise<void> {
  await auth().sendPasswordResetEmail(email.trim(), {
    url: 'https://balancesheet-android.web.app/reset-password',
    handleCodeInApp: true,
    android: {
      packageName: 'com.kaushikmajumder.receiptscanner',
      installApp: false,
    },
    iOS: {
      bundleId: 'com.kaushikmajumder.receiptscanner',
    },
  });
}

export async function signInWithPhone(phoneNumber: string): Promise<ConfirmationResult> {
  return auth().signInWithPhoneNumber(phoneNumber.trim());
}

export async function confirmPhoneCode(
  confirmation: ConfirmationResult,
  code: string,
): Promise<AuthUser> {
  const cred = await confirmation.confirm(code.trim());
  if (!cred?.user) throw new Error('Phone confirmation failed.');
  return cred.user;
}

export async function signInWithGoogle(): Promise<AuthUser> {
  await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
  let response;
  try {
    response = await GoogleSignin.signIn();
  } catch (e) {
    if (isErrorWithCode(e) && e.code === statusCodes.SIGN_IN_CANCELLED) {
      const cancelled: Error & { code: string } = Object.assign(new Error('Sign-in cancelled'), {
        code: 'SIGN_IN_CANCELLED',
      });
      throw cancelled;
    }
    throw e;
  }
  if (!isSuccessResponse(response)) {
    const cancelled: Error & { code: string } = Object.assign(new Error('Sign-in cancelled'), {
      code: 'SIGN_IN_CANCELLED',
    });
    throw cancelled;
  }
  const idToken = response.data.idToken;
  if (!idToken) throw new Error('No Google ID token returned.');
  const credential = auth.GoogleAuthProvider.credential(idToken);
  const cred = await auth().signInWithCredential(credential);
  return cred.user;
}

export async function reloadCurrentUser(): Promise<AuthUser | null> {
  const u = auth().currentUser;
  if (!u) return null;
  await u.reload();
  return auth().currentUser;
}

export async function deleteCurrentAccount(): Promise<void> {
  const u = auth().currentUser;
  if (!u) throw new Error('Not signed in.');
  // Best-effort sign out from Google before deleting Firebase account so
  // the next sign-in starts truly fresh.
  try {
    if (await GoogleSignin.getCurrentUser()) {
      await GoogleSignin.signOut();
    }
  } catch {
    // ignore
  }
  await u.delete();
}

export async function signOutEverywhere(): Promise<void> {
  try {
    if (await GoogleSignin.getCurrentUser()) {
      await GoogleSignin.signOut();
    }
  } catch {
    // ignore — Google sign-out is best-effort
  }
  await auth().signOut();
}

export { statusCodes as GoogleStatusCodes };
