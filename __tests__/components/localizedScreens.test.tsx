import React from 'react';
import { Alert } from 'react-native';
import { render, fireEvent, waitFor, screen } from '@testing-library/react-native';
import type { Receipt } from '../../types';

const mockPush = jest.fn();

jest.mock('expo-router', () => ({
  useRouter: () => ({ back: jest.fn(), push: mockPush }),
  useFocusEffect: (cb: () => void) => {
    require('react').useEffect(cb, []);
  },
}));

jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));

jest.mock('../../lib/database', () => ({
  getReviewQueueReceipts: jest.fn(),
  removeFromReviewQueue: jest.fn(async () => undefined),
  clearReviewQueue: jest.fn(async () => undefined),
  deleteReceipt: jest.fn(async () => undefined),
  getAllReceipts: jest.fn(),
  getAllIncomes: jest.fn(async () => []),
}));

jest.mock('../../lib/secureStorage', () => ({
  getCurrency: jest.fn(async () => 'USD'),
  getLanguagePreference: jest.fn(async () => 'fr'),
  setLanguagePreference: jest.fn(async () => undefined),
}));

import { I18nProvider } from '../../lib/I18nContext';
import { setActiveLanguage } from '../../lib/i18n';
import ReviewScreen from '../../app/review';
import RecurringScreen from '../../app/recurring';
import { getReviewQueueReceipts, getAllReceipts } from '../../lib/database';

const mockGetQueue = getReviewQueueReceipts as jest.Mock;
const mockGetAllReceipts = getAllReceipts as jest.Mock;

function makeReceipt(overrides: Partial<Receipt>): Receipt {
  return {
    id: 'r1',
    storeName: 'Gym',
    date: '2026-09-04',
    totalAmount: 50,
    category: 'Groceries',
    ...overrides,
  } as Receipt;
}

const inFrench = (ui: React.ReactElement) => render(<I18nProvider>{ui}</I18nProvider>);

beforeEach(() => {
  jest.clearAllMocks();
  setActiveLanguage('en');
});

describe('French UI', () => {
  it('Review: empty state and header are French', async () => {
    mockGetQueue.mockResolvedValue([]);
    inFrench(<ReviewScreen />);
    await waitFor(() => expect(screen.getByText('Tout est à jour')).toBeTruthy());
    expect(screen.getByText('Vérification')).toBeTruthy();
  });

  it('Review: rows show translated category, French date, and French actions', async () => {
    mockGetQueue.mockResolvedValue([makeReceipt({ id: 'r1', storeName: 'Metro' })]);
    inFrench(<ReviewScreen />);
    await waitFor(() => expect(screen.getByText('Metro')).toBeTruthy());
    expect(screen.getByText('Épicerie · 4 sept. 2026')).toBeTruthy();
    expect(screen.getByText("C'est bon")).toBeTruthy();
    expect(screen.getByText('Modifier')).toBeTruthy();
    expect(screen.getByText('Supprimer')).toBeTruthy();
    expect(screen.getByText("C'est bon — tout approuver (1)")).toBeTruthy();
  });

  it('Review: delete confirmation is French', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    mockGetQueue.mockResolvedValue([makeReceipt({ id: 'r1', storeName: 'Metro' })]);
    inFrench(<ReviewScreen />);
    await waitFor(() => screen.getByTestId('review-delete-r1'));
    fireEvent.press(screen.getByTestId('review-delete-r1'));
    expect(alertSpy).toHaveBeenCalledWith(
      'Supprimer la dépense ?',
      'Metro sera supprimé.',
      expect.any(Array),
    );
    alertSpy.mockRestore();
  });

  it('Recurring: French schedule line with translated frequency and date', async () => {
    mockGetAllReceipts.mockResolvedValue([
      makeReceipt({
        id: 'r1',
        storeName: 'Gym',
        category: 'Healthcare',
        recurring: { frequency: 'biweekly', nextDueDate: '2026-09-18', endDate: '2027-01-01' },
      }),
    ]);
    inFrench(<RecurringScreen />);
    await waitFor(() => expect(screen.getByText('Gym')).toBeTruthy());
    expect(screen.getByText('Aux deux semaines · Prochain : 18 sept. 2026')).toBeTruthy();
    expect(screen.getByText('Se termine le 1 janv. 2027')).toBeTruthy();
  });
});
