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

jest.mock('@expo/vector-icons', () => ({
  Ionicons: () => null,
}));

jest.mock('../../lib/database', () => ({
  getReviewQueueReceipts: jest.fn(),
  removeFromReviewQueue: jest.fn(async () => undefined),
  clearReviewQueue: jest.fn(async () => undefined),
  deleteReceipt: jest.fn(async () => undefined),
}));

jest.mock('../../lib/secureStorage', () => ({
  getCurrency: jest.fn(async () => 'USD'),
}));

import ReviewScreen from '../../app/review';
import {
  getReviewQueueReceipts,
  removeFromReviewQueue,
  clearReviewQueue,
  deleteReceipt,
} from '../../lib/database';

const mockGetQueue = getReviewQueueReceipts as jest.Mock;
const mockRemove = removeFromReviewQueue as jest.Mock;
const mockClear = clearReviewQueue as jest.Mock;
const mockDelete = deleteReceipt as jest.Mock;

function makeReceipt(overrides: Partial<Receipt>): Receipt {
  return {
    id: 'r1',
    storeName: 'Gym',
    date: '2026-09-01',
    totalAmount: 50,
    category: 'Healthcare',
    ...overrides,
  } as Receipt;
}

describe('ReviewScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('shows the empty state when nothing awaits review', async () => {
    mockGetQueue.mockResolvedValue([]);
    render(<ReviewScreen />);
    await waitFor(() => expect(screen.getByText('All caught up')).toBeTruthy());
  });

  it('lists queued expenses with name and amount', async () => {
    mockGetQueue.mockResolvedValue([
      makeReceipt({ id: 'r1', storeName: 'Gym', totalAmount: 50 }),
      makeReceipt({ id: 'r2', storeName: 'Netflix', totalAmount: 15 }),
    ]);
    render(<ReviewScreen />);
    await waitFor(() => expect(screen.getByText('Gym')).toBeTruthy());
    expect(screen.getByText('Netflix')).toBeTruthy();
    expect(screen.getByText('$50.00')).toBeTruthy();
    expect(screen.getByText('Looks good — approve all (2)')).toBeTruthy();
  });

  it('approving one row removes it from the queue and reloads', async () => {
    mockGetQueue
      .mockResolvedValueOnce([makeReceipt({ id: 'r1' }), makeReceipt({ id: 'r2', storeName: 'Netflix' })])
      .mockResolvedValueOnce([makeReceipt({ id: 'r2', storeName: 'Netflix' })]);
    render(<ReviewScreen />);
    await waitFor(() => screen.getByTestId('review-approve-r1'));
    fireEvent.press(screen.getByTestId('review-approve-r1'));
    await waitFor(() => expect(mockRemove).toHaveBeenCalledWith('r1'));
    await waitFor(() => expect(screen.queryByTestId('review-row-r1')).toBeNull());
    expect(screen.getByTestId('review-row-r2')).toBeTruthy();
  });

  it('approve all clears the queue and shows the empty state', async () => {
    mockGetQueue
      .mockResolvedValueOnce([makeReceipt({ id: 'r1' })])
      .mockResolvedValueOnce([]);
    render(<ReviewScreen />);
    await waitFor(() => screen.getByTestId('review-approve-all'));
    fireEvent.press(screen.getByTestId('review-approve-all'));
    await waitFor(() => expect(mockClear).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByText('All caught up')).toBeTruthy());
  });

  it('shows an error state, not "All caught up", when loading fails', async () => {
    mockGetQueue.mockRejectedValue(new Error('db'));
    render(<ReviewScreen />);
    await waitFor(() => expect(screen.getByText("Couldn't load review items")).toBeTruthy());
    expect(screen.queryByText('All caught up')).toBeNull();
  });

  it('alerts instead of throwing when approving fails', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    mockGetQueue.mockResolvedValue([makeReceipt({ id: 'r1' })]);
    mockRemove.mockRejectedValueOnce(new Error('db'));
    render(<ReviewScreen />);
    await waitFor(() => screen.getByTestId('review-approve-r1'));
    fireEvent.press(screen.getByTestId('review-approve-r1'));
    await waitFor(() => expect(alertSpy).toHaveBeenCalledWith('Something went wrong', 'Please try again.'));
    expect(screen.getByTestId('review-row-r1')).toBeTruthy();
    alertSpy.mockRestore();
  });

  it('Edit opens the receipt editor', async () => {
    mockGetQueue.mockResolvedValue([makeReceipt({ id: 'r1' })]);
    render(<ReviewScreen />);
    await waitFor(() => screen.getByTestId('review-edit-r1'));
    fireEvent.press(screen.getByTestId('review-edit-r1'));
    expect(mockPush).toHaveBeenCalledWith('/edit/r1');
  });

  it('Delete asks to confirm, then deletes the receipt', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    mockGetQueue
      .mockResolvedValueOnce([makeReceipt({ id: 'r1' })])
      .mockResolvedValueOnce([]);
    render(<ReviewScreen />);
    await waitFor(() => screen.getByTestId('review-delete-r1'));
    fireEvent.press(screen.getByTestId('review-delete-r1'));
    expect(mockDelete).not.toHaveBeenCalled();
    const buttons = alertSpy.mock.calls[0][2] as { text: string; onPress?: () => Promise<void> }[];
    await buttons.find((b) => b.text === 'Delete')!.onPress!();
    expect(mockDelete).toHaveBeenCalledWith('r1');
    alertSpy.mockRestore();
  });
});
