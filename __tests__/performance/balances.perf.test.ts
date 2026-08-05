import { performance } from 'perf_hooks';
import { computeMemberBalances } from '../../lib/balances';
import { Receipt, Settlement } from '../../types';
import { HouseholdMember } from '../../lib/cloudSync';

/**
 * Benchmark: computeMemberBalances across a large household ledger.
 *
 * computeMemberBalances loops over every receipt once per OTHER
 * household member (O(receipts * members)), then every settlement once
 * per member (O(settlements * members)). With a fixed, realistic member
 * count this is effectively O(receipts + settlements). This guards
 * against a future change that, per receipt, scans the receipt list
 * again (or does a settlements lookup per receipt) — which would turn
 * this quadratic in the receipt count instead of linear.
 */

const SELF_UID = 'self-uid';
const MEMBER_COUNT = 6;
const RECEIPT_COUNT = 2000;
const SETTLEMENT_COUNT = 300;

function buildMembers(count: number): HouseholdMember[] {
  const members: HouseholdMember[] = [
    {
      uid: SELF_UID,
      displayName: 'Me',
      email: 'me@example.com',
      role: 'owner',
      isYou: true,
    },
  ];
  for (let i = 0; i < count; i++) {
    members.push({
      uid: `member-${i}`,
      displayName: `Member ${i}`,
      email: `member${i}@example.com`,
      role: 'member',
      isYou: false,
    });
  }
  return members;
}

function buildReceipts(count: number, memberUids: string[]): Receipt[] {
  const receipts: Receipt[] = [];
  for (let i = 0; i < count; i++) {
    const other = memberUids[i % memberUids.length];
    const payer = i % 2 === 0 ? SELF_UID : other;
    receipts.push({
      id: `r${i}`,
      storeName: `Store ${i % 50}`,
      date: new Date(2026, 0, 1 + (i % 28)).toISOString(),
      totalAmount: 20 + (i % 40),
      category: 'Groceries',
      paidBy: payer,
      split: {
        enabled: true,
        method: 'equal',
        participantIds: [SELF_UID, other],
      },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  }
  return receipts;
}

function buildSettlements(count: number, memberUids: string[]): Settlement[] {
  const settlements: Settlement[] = [];
  for (let i = 0; i < count; i++) {
    const other = memberUids[i % memberUids.length];
    settlements.push({
      id: `s${i}`,
      fromUid: i % 2 === 0 ? SELF_UID : other,
      toUid: i % 2 === 0 ? other : SELF_UID,
      amountUsd: 10 + (i % 20),
      createdAt: new Date().toISOString(),
    });
  }
  return settlements;
}

describe('balances performance', () => {
  it(`computes balances for ${RECEIPT_COUNT} receipts / ${MEMBER_COUNT} members within budget`, () => {
    const members = buildMembers(MEMBER_COUNT);
    const memberUids = members.filter((m) => m.uid !== SELF_UID).map((m) => m.uid);
    const receipts = buildReceipts(RECEIPT_COUNT, memberUids);
    const settlements = buildSettlements(SETTLEMENT_COUNT, memberUids);

    const start = performance.now();
    const balances = computeMemberBalances(receipts, settlements, SELF_UID, members);
    const durationMs = performance.now() - start;

    expect(balances.length).toBe(MEMBER_COUNT);
    expect(balances.some((b) => b.receiptIds.length > 0)).toBe(true);

    // Generous ceiling for receipts*members nested-loop work at this
    // scale — catches an accidental extra O(n) scan inside the loop.
    expect(durationMs).toBeLessThan(500);
  });

  it('scales roughly linearly, not quadratically, with receipt count', () => {
    const members = buildMembers(MEMBER_COUNT);
    const memberUids = members.filter((m) => m.uid !== SELF_UID).map((m) => m.uid);

    const small = buildReceipts(250, memberUids);
    const large = buildReceipts(2000, memberUids); // 8x
    const settlements = buildSettlements(50, memberUids);

    const t0 = performance.now();
    computeMemberBalances(small, settlements, SELF_UID, members);
    const smallMs = performance.now() - t0;

    const t1 = performance.now();
    computeMemberBalances(large, settlements, SELF_UID, members);
    const largeMs = performance.now() - t1;

    expect(largeMs).toBeLessThan(Math.max(smallMs, 1) * 40);
  });
});
