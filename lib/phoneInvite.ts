import { addHouseholdMemberByPhone } from './cloudSync';

/**
 * "Add household member by phone" flow. Matching/invite bookkeeping is
 * entirely client-side Firestore (lib/cloudSync.ts's
 * addHouseholdMemberByPhone) — no backend involved for that at all.
 *
 * For the NO-MATCH case, we used to auto-send an SMS via a Cloudflare
 * Worker wrapping Twilio (scripts/sms-invite-worker.ts, still deployed
 * and functional) — dropped as the default because Twilio trial
 * accounts can only send from a small fixed set of canned demo
 * messages, not real custom text (error 572006), and the user isn't
 * ready to pay for a full Twilio account. Instead, the app hands the
 * invite text to the OS's native share sheet (Share.share, in
 * app/settings.tsx) so the INVITER sends it themselves via their own
 * Messages/WhatsApp/etc — free, no third-party SMS account needed.
 */
export type AddByPhoneResult =
  | { ok: true; matched: true; displayName: string | null }
  | { ok: true; matched: false; inviteText: string }
  | { ok: false; reason: string };

export async function addByPhone(args: {
  phoneE164: string;
  householdId: string;
  householdName: string | null;
  invitedByUid: string;
  invitedByName: string | null;
}): Promise<AddByPhoneResult> {
  const result = await addHouseholdMemberByPhone(args);
  if (!result.ok) return result;
  if (result.matched) {
    return { ok: true, matched: true, displayName: result.displayName };
  }
  const inviterLabel = args.invitedByName?.trim() || 'Someone';
  const householdLabel = args.householdName?.trim() || 'their household';
  const inviteText = `${inviterLabel} invited you to split expenses on BalanceSheet (${householdLabel}). Install the app and verify this phone number to join.`;
  return { ok: true, matched: false, inviteText };
}
