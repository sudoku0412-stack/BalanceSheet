import auth from '@react-native-firebase/auth';
import { ConfirmationResult, getCurrentUser } from './auth';
import { setProfilePhone } from './profile';
import { syncPhoneToCloud, setPhoneIndex, clearPhoneIndex, acceptPhoneInviteIfAny } from './cloudSync';

/**
 * Adds a phone number to the ALREADY-SIGNED-IN account, distinct from
 * lib/auth.ts's signInWithPhone/confirmPhoneCode (which sign into/switch
 * accounts via confirmation.confirm()). There's no direct promise-based
 * "link" API on RNFirebase, so this reuses signInWithPhoneNumber purely
 * to send the SMS and get a verificationId, then confirmPhoneVerification
 * below builds a credential from that id + the entered code and links it
 * to currentUser instead of calling confirm() (which would sign in/switch
 * the current account rather than attach to it).
 */
export async function startPhoneVerification(phoneE164: string): Promise<ConfirmationResult> {
  if (!getCurrentUser()) throw new Error('Not signed in.');
  return auth().signInWithPhoneNumber(phoneE164);
}

/** Returns whether verifying this number auto-joined a household via a
 *  pending phone invite someone sent before this user signed up (see
 *  lib/cloudSync.ts's acceptPhoneInviteIfAny) — callers should refresh
 *  their household/member state when true. */
export async function confirmPhoneVerification(
  confirmation: ConfirmationResult,
  code: string,
): Promise<{ joinedHouseholdId?: string }> {
  const user = getCurrentUser();
  if (!user) throw new Error('Not signed in.');
  if (!confirmation.verificationId) throw new Error('Verification expired — request a new code.');
  const credential = auth.PhoneAuthProvider.credential(confirmation.verificationId, code.trim());
  const result = await user.linkWithCredential(credential);
  const phone = result.user.phoneNumber;
  await setProfilePhone(result.user.uid, phone, true);
  await syncPhoneToCloud(result.user.uid, phone, true);
  if (!phone) return {};
  await setPhoneIndex(result.user.uid, phone);
  const accepted = await acceptPhoneInviteIfAny(result.user.uid, phone);
  return accepted.joined ? { joinedHouseholdId: accepted.householdId } : {};
}

export async function removePhoneVerification(uid: string, previousPhone: string | null): Promise<void> {
  await setProfilePhone(uid, null, false);
  await syncPhoneToCloud(uid, null, false);
  if (previousPhone) await clearPhoneIndex(previousPhone);
}

/** auth/credential-already-in-use means this number is already linked
 *  to a DIFFERENT Firebase account — surface that distinctly rather
 *  than a generic failure. */
export function isPhoneAlreadyInUseError(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code?: string }).code === 'auth/credential-already-in-use'
  );
}
