import React from 'react';
import { render, waitFor, screen } from '@testing-library/react-native';
import { StyleSheet, Text } from 'react-native';
import type { Receipt } from '../../types';
import type { HouseholdMember } from '../../lib/cloudSync';

// Regression test for app/shared-expenses/[uid].tsx: the hero total
// amount's owed-to-you (green-ish tint) vs you-owe (red-ish tint) color
// coding was recently, accidentally flattened to plain white during the
// visual restyle, then restored. This pins down that the two directions
// genuinely render with DIFFERENT colors — deliberately not asserting
// either literal hex value, just that the branch still branches.

const SELF_UID = 'self1';
const MEMBER_UID = 'member1';

jest.mock('expo-router', () => ({
  useRouter: () => ({ back: jest.fn(), push: jest.fn() }),
  useLocalSearchParams: () => ({ uid: MEMBER_UID }),
  useFocusEffect: (cb: () => void) => {
    require('react').useEffect(cb, []);
  },
}));

jest.mock('../../lib/database', () => ({
  getAllReceipts: jest.fn(),
  getAllSettlements: jest.fn(async () => []),
  getCurrentHouseholdId: jest.fn(() => 'hh1'),
}));

jest.mock('../../lib/cloudSync', () => ({
  getHouseholdMembers: jest.fn(async () => [
    { uid: MEMBER_UID, email: 'member@example.com', displayName: 'Alex Rivera', role: 'member', isYou: false },
  ]),
}));

jest.mock('../../lib/auth', () => ({
  getCurrentUser: jest.fn(() => ({ uid: SELF_UID })),
}));

jest.mock('../../lib/secureStorage', () => ({
  getCurrency: jest.fn(async () => 'USD'),
}));

import SharedExpensesScreen from '../../app/shared-expenses/[uid]';
import { getAllReceipts } from '../../lib/database';

const mockGetAllReceipts = getAllReceipts as jest.Mock;

function receiptOwedToSelf(id: string, amount: number): Receipt {
  // Self paid, split equally between self and member => member owes half.
  return {
    id,
    storeName: 'Store',
    date: '2026-01-01',
    totalAmount: amount,
    category: 'Other',
    paidBy: SELF_UID,
    split: { enabled: true, method: 'equal', participantIds: [SELF_UID, MEMBER_UID] },
  } as Receipt;
}

function receiptSelfOwes(id: string, amount: number): Receipt {
  // Member paid, split equally => self owes half.
  return {
    id,
    storeName: 'Store 2',
    date: '2026-01-02',
    totalAmount: amount,
    category: 'Other',
    paidBy: MEMBER_UID,
    split: { enabled: true, method: 'equal', participantIds: [SELF_UID, MEMBER_UID] },
  } as Receipt;
}

/** Finds the hero total-amount Text by its distinctive fontSize (30,
 *  set once on styles.totalAmount and shared by both owed-direction
 *  branches) rather than by a fixed parent/child hop count, which would
 *  silently break the next time this card's JSX nesting changes. */
function getTotalAmountColor() {
  const amountNode = screen.UNSAFE_getAllByType(Text).find((n) => {
    const flattened = StyleSheet.flatten(n.props.style);
    return flattened?.fontSize === 30;
  });
  expect(amountNode).toBeTruthy();
  const flattened = StyleSheet.flatten(amountNode!.props.style);
  return flattened?.color;
}

describe('SharedExpensesScreen owed-direction color coding', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders a different total-amount color for "owes you" vs "you owe"', async () => {
    mockGetAllReceipts.mockResolvedValueOnce([receiptOwedToSelf('r1', 100)]);
    const { unmount } = render(<SharedExpensesScreen />);
    await waitFor(() => {
      expect(screen.getByText('Alex Rivera owes you')).toBeTruthy();
    });
    const owesYouColor = getTotalAmountColor();
    unmount();

    mockGetAllReceipts.mockResolvedValueOnce([receiptSelfOwes('r2', 100)]);
    render(<SharedExpensesScreen />);
    await waitFor(() => {
      expect(screen.getByText('You owe Alex Rivera')).toBeTruthy();
    });
    const youOweColor = getTotalAmountColor();

    // The regression this guards against: both directions flattened to
    // the same (white) color, silently dropping the owed-direction cue.
    expect(owesYouColor).toBeTruthy();
    expect(youOweColor).toBeTruthy();
    expect(owesYouColor).not.toBe(youOweColor);
    expect(owesYouColor).not.toBe('#FFFFFF');
    expect(youOweColor).not.toBe('#FFFFFF');
  });
});
