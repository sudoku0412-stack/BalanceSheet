import React from 'react';
import { Alert, Linking } from 'react-native';
import { render, fireEvent, waitFor, screen } from '@testing-library/react-native';

const mockReplace = jest.fn();
const mockPush = jest.fn();
let mockIsPremium = true;
let mockConfigured = true;

jest.mock('expo-router', () => ({
  router: {
    replace: (...a: unknown[]) => mockReplace(...a),
    push: (...a: unknown[]) => mockPush(...a),
    back: jest.fn(),
  },
  useFocusEffect: (cb: () => void) => {
    require('react').useEffect(cb, []);
  },
}));

jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));

jest.mock('../../lib/EntitlementsContext', () => ({
  useEntitlements: () => ({ isPremium: mockIsPremium, loading: false }),
}));

jest.mock('../../lib/secureStorage', () => ({ getCurrency: jest.fn(async () => 'CAD') }));

jest.mock('../../lib/bankSync', () => ({
  isBankSyncConfigured: () => mockConfigured,
  listBankItems: jest.fn(),
  startBankLink: jest.fn(),
  completeBankLink: jest.fn(),
  removeBankItem: jest.fn(async () => ({ ok: true })),
  syncBankTransactions: jest.fn(),
  getPendingLinkToken: jest.fn(),
  setPendingLinkToken: jest.fn(async () => undefined),
  clearPendingLinkToken: jest.fn(async () => undefined),
}));

import BankScreen from '../../app/bank';
import * as bank from '../../lib/bankSync';

const m = bank as unknown as Record<string, jest.Mock>;

beforeEach(() => {
  jest.clearAllMocks();
  mockIsPremium = true;
  mockConfigured = true;
  m.listBankItems.mockResolvedValue([]);
  m.getPendingLinkToken.mockResolvedValue(null);
  m.syncBankTransactions.mockResolvedValue({ imported: 0, updated: 0, removed: 0, notReady: 0 });
});

describe('BankScreen', () => {
  it('free users are sent to the paywall', async () => {
    mockIsPremium = false;
    render(<BankScreen />);
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/paywall'));
  });

  it('shows a "not available" state when this build has no endpoint', async () => {
    mockConfigured = false;
    render(<BankScreen />);
    expect(screen.getByText("Bank connections aren't available in this build yet.")).toBeTruthy();
    expect(screen.queryByText('Connect a bank')).toBeNull();
    expect(m.listBankItems).not.toHaveBeenCalled();
  });

  it('lists connected banks, or says there are none', async () => {
    render(<BankScreen />);
    await waitFor(() => expect(screen.getByText('No banks connected yet')).toBeTruthy());
    expect(screen.queryByText('Sync now')).toBeNull();
  });

  it('Connect a bank starts a link, remembers it, and opens the hosted page', async () => {
    const openSpy = jest.spyOn(Linking, 'openURL').mockResolvedValue(true as never);
    m.startBankLink.mockResolvedValue({ linkToken: 'lt-1', url: 'https://hosted.plaid.com/x' });
    render(<BankScreen />);
    await waitFor(() => screen.getByText('Connect a bank'));
    fireEvent.press(screen.getByText('Connect a bank'));
    await waitFor(() => expect(openSpy).toHaveBeenCalledWith('https://hosted.plaid.com/x'));
    expect(m.startBankLink).toHaveBeenCalledWith('en');
    expect(m.setPendingLinkToken).toHaveBeenCalledWith('lt-1');
    await waitFor(() => expect(screen.getByTestId('bank-waiting')).toBeTruthy());
    openSpy.mockRestore();
  });

  it('on return, finishes a pending link, announces the bank and syncs', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    m.getPendingLinkToken.mockResolvedValue('lt-1');
    m.completeBankLink.mockResolvedValue({ connected: [{ itemId: 'i1', institution: 'RBC' }], pending: false });
    render(<BankScreen />);
    await waitFor(() => expect(m.clearPendingLinkToken).toHaveBeenCalled());
    expect(alertSpy).toHaveBeenCalledWith('Bank connections', 'RBC connected');
    await waitFor(() => expect(m.syncBankTransactions).toHaveBeenCalledWith('CAD'));
    alertSpy.mockRestore();
  });

  it('keeps waiting (and the pending token) while the user has not finished', async () => {
    m.getPendingLinkToken.mockResolvedValue('lt-1');
    m.completeBankLink.mockResolvedValue({ connected: [], pending: true });
    render(<BankScreen />);
    await waitFor(() => expect(screen.getByTestId('bank-waiting')).toBeTruthy());
    expect(m.clearPendingLinkToken).not.toHaveBeenCalled();
  });

  it('Sync now reports the import and offers to open Review', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    m.listBankItems.mockResolvedValue([{ itemId: 'i1', institution: 'TD' }]);
    m.syncBankTransactions.mockResolvedValue({ imported: 3, updated: 1, removed: 0, notReady: 0 });
    render(<BankScreen />);
    await waitFor(() => screen.getByText('Sync now'));
    fireEvent.press(screen.getByText('Sync now'));
    await waitFor(() => expect(alertSpy).toHaveBeenCalled());
    const [title, message, buttons] = alertSpy.mock.calls[0] as [string, string, { text: string; onPress?: () => void }[]];
    expect(title).toBe('Bank connections');
    expect(message).toBe('Imported 3 new, updated 1, removed 0.');
    buttons.find((b) => b.text === 'Review')!.onPress!();
    expect(mockPush).toHaveBeenCalledWith('/review');
    alertSpy.mockRestore();
  });

  it('Sync now says so when nothing is new, and mentions connections still preparing', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    m.listBankItems.mockResolvedValue([{ itemId: 'i1', institution: 'TD' }]);
    m.syncBankTransactions.mockResolvedValue({ imported: 0, updated: 0, removed: 0, notReady: 1 });
    render(<BankScreen />);
    await waitFor(() => screen.getByText('Sync now'));
    fireEvent.press(screen.getByText('Sync now'));
    await waitFor(() => expect(alertSpy).toHaveBeenCalled());
    expect(alertSpy.mock.calls[0][1]).toBe(
      'No new transactions.\n\nSome connections are still preparing their history. Try again in a minute.',
    );
    alertSpy.mockRestore();
  });

  it('shows an error alert when syncing fails', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    m.listBankItems.mockResolvedValue([{ itemId: 'i1', institution: 'TD' }]);
    m.syncBankTransactions.mockRejectedValue(new Error('down'));
    render(<BankScreen />);
    await waitFor(() => screen.getByText('Sync now'));
    fireEvent.press(screen.getByText('Sync now'));
    await waitFor(() =>
      expect(alertSpy).toHaveBeenCalledWith('Bank connections', "Couldn't reach your bank connection. Try again."),
    );
    alertSpy.mockRestore();
  });

  it('Disconnect asks to confirm, then removes the connection and reloads', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    m.listBankItems.mockResolvedValue([{ itemId: 'i1', institution: 'TD' }]);
    render(<BankScreen />);
    await waitFor(() => screen.getByTestId('bank-disconnect-i1'));
    fireEvent.press(screen.getByTestId('bank-disconnect-i1'));
    expect(m.removeBankItem).not.toHaveBeenCalled();
    const buttons = alertSpy.mock.calls[0][2] as { text: string; onPress?: () => Promise<void> }[];
    await buttons.find((b) => b.text === 'Disconnect')!.onPress!();
    expect(m.removeBankItem).toHaveBeenCalledWith('i1');
    expect(m.listBankItems).toHaveBeenCalledTimes(2);
    alertSpy.mockRestore();
  });
});
