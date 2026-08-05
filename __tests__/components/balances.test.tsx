import React from 'react';
import { render, fireEvent, waitFor, screen, act } from '@testing-library/react-native';
import { Alert } from 'react-native';
import type { Receipt, Settlement } from '../../types';
import type { HouseholdMember } from '../../lib/cloudSync';

// NOTE: mocks below that return plain object literals (expo-router,
// lib/database, lib/cloudSync, lib/auth, lib/secureStorage, lib/notifications)
// build their jest.fn()s inline rather than closing over an outer const —
// those factories run eagerly at first require, which (via ES import
// hoisting) can happen before an outer `const mock... = jest.fn()` in this
// file is actually assigned. We recover references to the created fns
// afterwards via the (now-mocked) module's exports. Mocks like useAuth/
// useToast are safe to close over outer consts since they're wrapped in a
// function only invoked later at render time.
const mockToastShow = jest.fn();

jest.mock('expo-router', () => ({
  useRouter: () => ({ back: jest.fn(), push: jest.fn() }),
  useFocusEffect: (cb: () => void) => {
    require('react').useEffect(cb, []);
  },
}));

jest.mock('@expo/vector-icons', () => ({
  Ionicons: () => null,
}));

jest.mock('../../lib/AuthContext', () => ({
  useAuth: () => ({ profile: { firstName: 'Jane', lastName: 'Doe' } }),
}));

jest.mock('../../components/ui/Toast', () => ({
  useToast: () => ({ show: mockToastShow, dismiss: jest.fn() }),
}));

jest.mock('../../lib/database', () => ({
  getAllReceipts: jest.fn(),
  getAllSettlements: jest.fn(),
  getCurrentHouseholdId: jest.fn(),
  insertSettlement: jest.fn(),
}));

jest.mock('../../lib/cloudSync', () => ({
  getHouseholdMembers: jest.fn(),
}));

jest.mock('../../lib/auth', () => ({
  getCurrentUser: jest.fn(),
}));

jest.mock('../../lib/secureStorage', () => ({
  getCurrency: jest.fn(async () => 'USD'),
}));

jest.mock('../../lib/notifications', () => ({
  notifySettleUp: jest.fn(),
}));

jest.mock('uuid', () => ({
  v4: () => 'mock-uuid',
}));

import BalancesScreen from '../../app/balances';
import { getAllReceipts, getAllSettlements, getCurrentHouseholdId, insertSettlement } from '../../lib/database';
import { getHouseholdMembers } from '../../lib/cloudSync';
import { getCurrentUser } from '../../lib/auth';
import { getCurrency } from '../../lib/secureStorage';
import { notifySettleUp } from '../../lib/notifications';

const mockGetAllReceipts = getAllReceipts as jest.Mock;
const mockGetAllSettlements = getAllSettlements as jest.Mock;
const mockGetCurrentHouseholdId = getCurrentHouseholdId as jest.Mock;
const mockInsertSettlement = insertSettlement as jest.Mock;
const mockGetHouseholdMembers = getHouseholdMembers as jest.Mock;
const mockGetCurrentUser = getCurrentUser as jest.Mock;
const mockGetCurrency = getCurrency as jest.Mock;
const mockNotifySettleUp = notifySettleUp as jest.Mock;

const SELF_UID = 'self1';
const MEMBER_UID = 'member1';

const member: HouseholdMember = {
  uid: MEMBER_UID,
  email: 'member@example.com',
  displayName: 'Alex Rivera',
  role: 'member',
  isYou: false,
};

function receiptOwedToSelf(id: string, amount: number): Receipt {
  // Self paid, split equally between self and member => member owes half.
  return {
    id,
    storeName: 'Store',
    date: '2026-01-01',
    totalAmount: amount,
    category: 'Other',
    paidBy: SELF_UID,
    split: {
      enabled: true,
      method: 'equal',
      participantIds: [SELF_UID, MEMBER_UID],
    },
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
    split: {
      enabled: true,
      method: 'equal',
      participantIds: [SELF_UID, MEMBER_UID],
    },
  } as Receipt;
}

async function setupDefaults({
  receipts = [] as Receipt[],
  settlements = [] as Settlement[],
  members = [member] as HouseholdMember[],
} = {}) {
  mockGetAllReceipts.mockResolvedValue(receipts);
  mockGetAllSettlements.mockResolvedValue(settlements);
  mockGetCurrentHouseholdId.mockReturnValue('hh1');
  mockGetHouseholdMembers.mockResolvedValue(members);
  mockGetCurrentUser.mockReturnValue({ uid: SELF_UID });
  mockGetCurrency.mockResolvedValue('USD');
  mockInsertSettlement.mockResolvedValue(undefined);
}

describe('BalancesScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('shows "All settled up" empty state when there is no balance history', async () => {
    await setupDefaults({ receipts: [] });
    render(<BalancesScreen />);

    await waitFor(() => {
      expect(screen.getByText('All settled up')).toBeTruthy();
    });
  });

  it('shows "Owes you" with the right amount when the member owes self', async () => {
    await setupDefaults({ receipts: [receiptOwedToSelf('r1', 100)] });
    render(<BalancesScreen />);

    await waitFor(() => {
      expect(screen.getByText('Alex Rivera')).toBeTruthy();
    });
    expect(screen.getByText('Owes you')).toBeTruthy();
    expect(screen.getByText('$50.00')).toBeTruthy();
    expect(screen.getByText('Mark as received')).toBeTruthy();
  });

  it('shows "You owe" with the right amount when self owes the member', async () => {
    await setupDefaults({ receipts: [receiptSelfOwes('r1', 100)] });
    render(<BalancesScreen />);

    await waitFor(() => {
      expect(screen.getByText('You owe')).toBeTruthy();
    });
    expect(screen.getByText('$50.00')).toBeTruthy();
    expect(screen.getByText('Settle up')).toBeTruthy();
  });

  it('shows "Settled up" once net balance is zeroed out by a settlement', async () => {
    await setupDefaults({
      receipts: [receiptOwedToSelf('r1', 100)],
      settlements: [
        { id: 's1', fromUid: MEMBER_UID, toUid: SELF_UID, amountUsd: 50, createdAt: '2026-01-03' },
      ],
    });
    render(<BalancesScreen />);

    await waitFor(() => {
      expect(screen.getByText('Settled up')).toBeTruthy();
    });
  });

  it('tapping "Mark as received" opens a confirm alert, and confirming settles up', async () => {
    await setupDefaults({ receipts: [receiptOwedToSelf('r1', 100)] });
    const alertSpy = jest.spyOn(Alert, 'alert');
    render(<BalancesScreen />);

    await waitFor(() => {
      expect(screen.getByText('Mark as received')).toBeTruthy();
    });
    fireEvent.press(screen.getByText('Mark as received'));

    expect(alertSpy).toHaveBeenCalledWith(
      'Settle up?',
      expect.stringContaining('$50.00'),
      expect.arrayContaining([
        expect.objectContaining({ text: 'Cancel' }),
        expect.objectContaining({ text: 'Settle up' }),
      ]),
    );

    // Simulate the user confirming via the "Settle up" button in the Alert.
    const buttons = alertSpy.mock.calls[0][2] as { text: string; onPress?: () => void }[];
    const confirmButton = buttons.find((b) => b.text === 'Settle up');
    await act(async () => {
      confirmButton?.onPress?.();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(mockInsertSettlement).toHaveBeenCalledWith(
        expect.objectContaining({
          fromUid: MEMBER_UID,
          toUid: SELF_UID,
          amountUsd: 50,
        }),
      );
    });
    await waitFor(() => {
      expect(mockToastShow).toHaveBeenCalledWith(
        expect.objectContaining({ kind: 'success', message: 'Settled up' }),
      );
    });
    expect(mockNotifySettleUp).toHaveBeenCalled();
  });
});
