import React from 'react';
import { Alert } from 'react-native';
import { render, fireEvent, waitFor, screen } from '@testing-library/react-native';
import type { InvestmentAccount, InvestmentSnapshot } from '../../types';

const mockReplace = jest.fn();
const mockPush = jest.fn();
const mockBack = jest.fn();
let mockParams: Record<string, string> = { id: 'a1' };
let mockIsPremium = true;

jest.mock('expo-router', () => ({
  router: {
    replace: (...a: unknown[]) => mockReplace(...a),
    push: (...a: unknown[]) => mockPush(...a),
    back: (...a: unknown[]) => mockBack(...a),
  },
  useLocalSearchParams: () => mockParams,
  useFocusEffect: (cb: () => void) => {
    require('react').useEffect(cb, []);
  },
}));

jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));

jest.mock('../../lib/EntitlementsContext', () => ({
  useEntitlements: () => ({ isPremium: mockIsPremium, loading: false }),
}));

jest.mock('../../lib/haptics', () => ({ notifySuccess: jest.fn(), tapLight: jest.fn() }));

jest.mock('uuid', () => {
  let n = 0;
  return { v4: () => `id-${++n}` };
});

jest.mock('../../lib/secureStorage', () => ({
  getCurrency: jest.fn(async () => 'USD'),
}));

jest.mock('../../lib/database', () => ({
  getAllInvestmentAccounts: jest.fn(),
  saveInvestmentAccount: jest.fn(async () => undefined),
  addInvestmentSnapshot: jest.fn(async () => undefined),
  getInvestmentAccountById: jest.fn(),
  getInvestmentSnapshots: jest.fn(async () => []),
  deleteInvestmentAccount: jest.fn(async () => undefined),
}));

import InvestmentsScreen from '../../app/investments';
import InvestmentDetailScreen from '../../app/investment/[id]';
import {
  addInvestmentSnapshot,
  deleteInvestmentAccount,
  getAllInvestmentAccounts,
  getInvestmentAccountById,
  getInvestmentSnapshots,
  saveInvestmentAccount,
} from '../../lib/database';

const mockGetAll = getAllInvestmentAccounts as jest.Mock;
const mockGetById = getInvestmentAccountById as jest.Mock;
const mockGetSnaps = getInvestmentSnapshots as jest.Mock;
const mockSave = saveInvestmentAccount as jest.Mock;
const mockAddSnap = addInvestmentSnapshot as jest.Mock;

const account = (o: Partial<InvestmentAccount> = {}): InvestmentAccount => ({
  id: 'a1',
  name: 'TFSA',
  kind: 'etf',
  contributedUsd: 1000,
  valueUsd: 1200,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...o,
});

beforeEach(() => {
  jest.clearAllMocks();
  mockIsPremium = true;
  mockParams = { id: 'a1' };
  mockGetAll.mockResolvedValue([]);
});

describe('InvestmentsScreen', () => {
  it('free users are sent to the paywall', async () => {
    mockIsPremium = false;
    render(<InvestmentsScreen />);
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/paywall'));
  });

  it('shows the empty state with no accounts', async () => {
    render(<InvestmentsScreen />);
    await waitFor(() => expect(screen.getByText('No investments yet')).toBeTruthy());
    expect(screen.queryByTestId('investments-summary')).toBeNull();
  });

  it('summarizes value, contributions and gain across accounts', async () => {
    mockGetAll.mockResolvedValue([account(), account({ id: 'a2', name: 'Crypto', contributedUsd: 500, valueUsd: 450 })]);
    render(<InvestmentsScreen />);
    await waitFor(() => expect(screen.getByTestId('investments-summary')).toBeTruthy());
    expect(screen.getByText('$1650.00')).toBeTruthy();
    expect(screen.getByText('$1500.00')).toBeTruthy();
    expect(screen.getByTestId('investments-gain').props.children).toBe('+$150.00 (+10.0%)');
    expect(screen.getByTestId('inv-account-a1')).toBeTruthy();
    expect(screen.getByTestId('inv-account-a2')).toBeTruthy();
  });

  it('tapping an account opens its detail', async () => {
    mockGetAll.mockResolvedValue([account()]);
    render(<InvestmentsScreen />);
    await waitFor(() => screen.getByTestId('inv-account-a1'));
    fireEvent.press(screen.getByTestId('inv-account-a1'));
    expect(mockPush).toHaveBeenCalledWith('/investment/a1');
  });

  it('requires a name', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    render(<InvestmentsScreen />);
    await waitFor(() => screen.getByText('Add account'));
    fireEvent.press(screen.getByText('Add account'));
    expect(alertSpy).toHaveBeenCalledWith('Name required', 'Name this account (e.g. TFSA).');
    expect(mockSave).not.toHaveBeenCalled();
    alertSpy.mockRestore();
  });

  it('creates an account (contributions default to the starting value) with an opening snapshot', async () => {
    render(<InvestmentsScreen />);
    await waitFor(() => screen.getByTestId('inv-name'));
    fireEvent.changeText(screen.getByTestId('inv-name'), '  RRSP ');
    fireEvent.press(screen.getByTestId('inv-kind-retirement'));
    fireEvent.changeText(screen.getByTestId('inv-value'), '2500');
    fireEvent.press(screen.getByText('Add account'));
    await waitFor(() => expect(mockSave).toHaveBeenCalled());
    expect(mockSave.mock.calls[0][0]).toMatchObject({
      name: 'RRSP',
      kind: 'retirement',
      valueUsd: 2500,
      contributedUsd: 2500,
    });
    expect(mockAddSnap.mock.calls[0][0]).toMatchObject({ valueUsd: 2500, contributedUsd: 2500 });
  });

  it('keeps an explicit contributed amount distinct from the value', async () => {
    render(<InvestmentsScreen />);
    await waitFor(() => screen.getByTestId('inv-name'));
    fireEvent.changeText(screen.getByTestId('inv-name'), 'Brokerage');
    fireEvent.changeText(screen.getByTestId('inv-value'), '1200');
    fireEvent.changeText(screen.getByTestId('inv-contributed'), '1000');
    fireEvent.press(screen.getByText('Add account'));
    await waitFor(() => expect(mockSave).toHaveBeenCalled());
    expect(mockSave.mock.calls[0][0]).toMatchObject({ valueUsd: 1200, contributedUsd: 1000 });
  });

  it('rejects malformed amounts', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    render(<InvestmentsScreen />);
    await waitFor(() => screen.getByTestId('inv-name'));
    fireEvent.changeText(screen.getByTestId('inv-name'), 'X');
    fireEvent.changeText(screen.getByTestId('inv-value'), '12.50.99');
    fireEvent.press(screen.getByText('Add account'));
    expect(alertSpy).toHaveBeenCalledWith('Invalid amount', 'Enter a valid amount (0 or more).');
    expect(mockSave).not.toHaveBeenCalled();
    alertSpy.mockRestore();
  });
});

describe('InvestmentDetailScreen', () => {
  beforeEach(() => {
    mockGetById.mockResolvedValue(account());
  });

  it('shows value, gain and contributions', async () => {
    render(<InvestmentDetailScreen />);
    await waitFor(() => expect(screen.getByTestId('inv-detail-value').props.children).toBe('$1200.00'));
    expect(screen.getByTestId('inv-detail-gain').props.children).toBe('+$200.00 (+20.0%)');
    expect(screen.getByText('Contributed: $1000.00')).toBeTruthy();
  });

  it('shows a not-found state for an unknown account', async () => {
    mockGetById.mockResolvedValue(null);
    render(<InvestmentDetailScreen />);
    await waitFor(() => expect(screen.getByText('Account not found')).toBeTruthy());
  });

  it('updating the value saves it and records a snapshot, leaving contributions alone', async () => {
    render(<InvestmentDetailScreen />);
    await waitFor(() => screen.getByTestId('inv-new-value'));
    fireEvent.changeText(screen.getByTestId('inv-new-value'), '1500');
    fireEvent.press(screen.getByText('Save value'));
    await waitFor(() => expect(mockSave).toHaveBeenCalled());
    expect(mockSave.mock.calls[0][0]).toMatchObject({ valueUsd: 1500, contributedUsd: 1000 });
    expect(mockAddSnap.mock.calls[0][0]).toMatchObject({ accountId: 'a1', valueUsd: 1500 });
  });

  it('a deposit raises contributions and value; a withdrawal lowers them', async () => {
    render(<InvestmentDetailScreen />);
    await waitFor(() => screen.getByTestId('inv-contribution'));
    fireEvent.changeText(screen.getByTestId('inv-contribution'), '300');
    fireEvent.press(screen.getByText('Deposit'));
    await waitFor(() => expect(mockSave).toHaveBeenCalledTimes(1));
    expect(mockSave.mock.calls[0][0]).toMatchObject({ contributedUsd: 1300, valueUsd: 1500 });

    fireEvent.changeText(screen.getByTestId('inv-contribution'), '200');
    fireEvent.press(screen.getByText('Withdraw'));
    await waitFor(() => expect(mockSave).toHaveBeenCalledTimes(2));
    expect(mockSave.mock.calls[1][0]).toMatchObject({ contributedUsd: 800, valueUsd: 1000 });
  });

  it('ignores an empty or zero contribution', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    render(<InvestmentDetailScreen />);
    await waitFor(() => screen.getByTestId('inv-contribution'));
    fireEvent.press(screen.getByText('Deposit'));
    fireEvent.changeText(screen.getByTestId('inv-contribution'), '0');
    fireEvent.press(screen.getByText('Withdraw'));
    expect(mockSave).not.toHaveBeenCalled();
    expect(alertSpy).toHaveBeenCalledTimes(2);
    alertSpy.mockRestore();
  });

  it('lists history and draws bars once there are two or more snapshots', async () => {
    const snaps: InvestmentSnapshot[] = [
      { id: 's2', accountId: 'a1', date: '2026-03-01', valueUsd: 1200, contributedUsd: 1000, createdAt: '' },
      { id: 's1', accountId: 'a1', date: '2026-01-01', valueUsd: 1000, contributedUsd: 1000, createdAt: '' },
    ];
    mockGetSnaps.mockResolvedValue(snaps);
    render(<InvestmentDetailScreen />);
    await waitFor(() => expect(screen.getByTestId('inv-bars')).toBeTruthy());
    expect(screen.getByText('Mar 1, 2026')).toBeTruthy();
    expect(screen.getByText('$1000.00')).toBeTruthy();
  });

  it('delete asks to confirm, then removes the account and goes back', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    render(<InvestmentDetailScreen />);
    await waitFor(() => screen.getByTestId('inv-delete'));
    fireEvent.press(screen.getByTestId('inv-delete'));
    expect(deleteInvestmentAccount).not.toHaveBeenCalled();
    const buttons = alertSpy.mock.calls[0][2] as { text: string; onPress?: () => Promise<void> }[];
    await buttons.find((b) => b.text === 'Delete')!.onPress!();
    expect(deleteInvestmentAccount).toHaveBeenCalledWith('a1');
    expect(mockBack).toHaveBeenCalled();
    alertSpy.mockRestore();
  });

  it('free users are sent to the paywall', async () => {
    mockIsPremium = false;
    render(<InvestmentDetailScreen />);
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/paywall'));
  });
});
