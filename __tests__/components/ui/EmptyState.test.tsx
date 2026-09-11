import React from 'react';
import { render, fireEvent, screen } from '@testing-library/react-native';
import { EmptyState } from '../../../components/ui/EmptyState';

jest.mock('@expo/vector-icons', () => ({
  Ionicons: () => null,
}));

describe('EmptyState', () => {
  it('renders title and description', () => {
    render(
      <EmptyState
        icon="receipt-outline"
        title="No receipts yet"
        description="Tap the camera button below to scan your first receipt."
      />,
    );
    expect(screen.getByText('No receipts yet')).toBeTruthy();
    expect(
      screen.getByText('Tap the camera button below to scan your first receipt.'),
    ).toBeTruthy();
  });

  it('omits the CTA when no actionLabel/onAction is given', () => {
    render(<EmptyState icon="receipt-outline" title="No receipts yet" />);
    expect(screen.queryByText(/scan/i)).toBeNull();
  });

  it('renders the CTA and fires onAction when tapped', () => {
    const onAction = jest.fn();
    render(
      <EmptyState
        icon="receipt-outline"
        title="No receipts yet"
        actionLabel="Scan a receipt"
        onAction={onAction}
      />,
    );
    fireEvent.press(screen.getByText('Scan a receipt'));
    expect(onAction).toHaveBeenCalledTimes(1);
  });
});
