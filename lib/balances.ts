import { Receipt, Settlement } from '../types';
import { HouseholdMember } from './cloudSync';

/**
 * `split.participantIds`/`LineItem.splitWith` used to store the literal
 * string 'self' for whichever device last saved the split — broken for
 * cross-device balances, since 'self' resolved to whoever was CURRENTLY
 * VIEWING rather than who actually saved it, silently dropping the real
 * creator out of the participant set on any other member's device (a
 * real bug: it showed "All settled up" for the other person even
 * though the split was real). Fixed at the source — app/edit/[id].tsx
 * and app/(tabs)/scan.tsx now substitute the signed-in user's REAL uid
 * for 'self' at save time, same as `paidBy` already did. `resolveSelf`
 * below still falls back to resolving a literal 'self' to the current
 * viewer for receipts saved BEFORE this fix — those old ones only
 * resolve correctly on the original creator's own device until
 * re-saved (e.g. toggling the split off and back on).
 */
function resolveSelf(id: string, selfUid: string): string {
  return id === 'self' ? selfUid : id;
}

/** USD-canonical amount `targetUid` owes on this one receipt (0 if
 *  they're not a participant, or split is disabled). Line-item
 *  `splitWith` overrides take priority over the receipt-level
 *  equal/percent/amount method when any item has one set, since that's
 *  a more specific instruction than the receipt-wide split. */
export function computeReceiptShare(
  receipt: Receipt,
  targetUid: string,
  selfUid: string,
): number {
  const split = receipt.split;
  if (!split?.enabled) return 0;
  const resolvedParticipants = split.participantIds.map((id) => resolveSelf(id, selfUid));
  if (!resolvedParticipants.includes(targetUid)) return 0;

  const itemsWithOverride = (receipt.lineItems ?? []).filter(
    (it) => it.splitWith && it.splitWith.length > 0,
  );
  if (itemsWithOverride.length > 0) {
    let total = 0;
    for (const item of receipt.lineItems ?? []) {
      const itemParticipants = item.splitWith?.length
        ? item.splitWith.map((id) => resolveSelf(id, selfUid))
        : resolvedParticipants;
      if (itemParticipants.includes(targetUid)) {
        total += item.amount / itemParticipants.length;
      }
    }
    return total;
  }

  const key = targetUid === selfUid ? 'self' : targetUid;
  switch (split.method) {
    case 'equal':
      return receipt.totalAmount / resolvedParticipants.length;
    case 'percent':
      return receipt.totalAmount * ((split.values?.[key] ?? 0) / 100);
    case 'amount':
      return split.values?.[key] ?? 0;
    default:
      return 0;
  }
}

/** Net USD contribution of ONE receipt to the self<->memberUid balance.
 *  Positive = memberUid owes self for this receipt; negative = self owes
 *  memberUid; 0 if the receipt doesn't involve both of them, or its
 *  payer is a third person. Shared by computeMemberBalances (summed
 *  across all receipts) and the shared-expenses screen (shown per-row). */
export function computeReceiptNet(
  receipt: Receipt,
  selfUid: string,
  memberUid: string,
): number {
  if (!receipt.split?.enabled) return 0;
  const payerUid = receipt.paidBy ?? selfUid;
  const resolvedParticipants = receipt.split.participantIds.map((id) => resolveSelf(id, selfUid));
  if (!resolvedParticipants.includes(selfUid) || !resolvedParticipants.includes(memberUid)) return 0;
  if (payerUid === selfUid) return computeReceiptShare(receipt, memberUid, selfUid);
  if (payerUid === memberUid) return -computeReceiptShare(receipt, selfUid, selfUid);
  return 0; // paid by a third person — doesn't affect this pair
}

/** Net USD contribution of ONE settlement to the self<->memberUid
 *  balance — same sign convention as computeReceiptNet (positive =
 *  memberUid owes self). Paying reduces what the payer owes, so a
 *  self->member payment nets +amount (self owes less); a member->self
 *  payment nets -amount (member owes less). 0 if the settlement doesn't
 *  involve this exact pair. */
export function computeSettlementNet(
  settlement: Settlement,
  selfUid: string,
  memberUid: string,
): number {
  if (settlement.fromUid === selfUid && settlement.toUid === memberUid) return settlement.amountUsd;
  if (settlement.fromUid === memberUid && settlement.toUid === selfUid) return -settlement.amountUsd;
  return 0;
}

/** Every settlement between self and memberUid, for the shared-expenses
 *  drill-down (shown alongside receipts so its total stays in sync with
 *  the Balances screen). */
export function getSettlementsForMemberPair(
  settlements: Settlement[],
  selfUid: string,
  memberUid: string,
): Settlement[] {
  return settlements.filter(
    (s) =>
      (s.fromUid === selfUid && s.toUid === memberUid) ||
      (s.fromUid === memberUid && s.toUid === selfUid),
  );
}

export type MemberBalance = {
  memberUid: string;
  /** Positive = they owe you. Negative = you owe them. USD-canonical —
   *  convert with lib/currency's formatCurrency only at render time. */
  netUsd: number;
  /** Every receipt id that contributed a nonzero amount, for drill-down. */
  receiptIds: string[];
};

/** Running net balance between the signed-in user and every OTHER
 *  household member, summed across every split-enabled receipt both
 *  are participants in, then offset by any "settle up" payments between
 *  the pair. `paidBy` (defaults to the creator at save time, see
 *  types/index.ts) determines direction; receipts saved before `paidBy`
 *  existed fall back to "you paid" so old split receipts still count
 *  instead of silently dropping out of the ledger. Settlements never
 *  touch a receipt's own totalAmount/reports — purely a balance offset. */
export function computeMemberBalances(
  receipts: Receipt[],
  settlements: Settlement[],
  selfUid: string,
  members: HouseholdMember[],
): MemberBalance[] {
  const balances = new Map<string, MemberBalance>();
  for (const m of members) {
    if (m.uid === selfUid) continue;
    balances.set(m.uid, { memberUid: m.uid, netUsd: 0, receiptIds: [] });
  }

  for (const receipt of receipts) {
    for (const [memberUid, bal] of balances) {
      const net = computeReceiptNet(receipt, selfUid, memberUid);
      if (net === 0) continue;
      bal.netUsd += net;
      bal.receiptIds.push(receipt.id);
    }
  }

  for (const settlement of settlements) {
    for (const [memberUid, bal] of balances) {
      bal.netUsd += computeSettlementNet(settlement, selfUid, memberUid);
    }
  }

  return Array.from(balances.values());
}

/** Every receipt contributing to the self<->memberUid balance, for the
 *  drill-down list on the Balances screen. */
export function getReceiptsForMemberPair(
  receipts: Receipt[],
  selfUid: string,
  memberUid: string,
): Receipt[] {
  return receipts.filter((r) => {
    if (!r.split?.enabled) return false;
    const resolved = r.split.participantIds.map((id) => resolveSelf(id, selfUid));
    return resolved.includes(selfUid) && resolved.includes(memberUid);
  });
}
