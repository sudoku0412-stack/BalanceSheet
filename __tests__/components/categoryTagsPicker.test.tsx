import React from 'react';
import { render, fireEvent, screen } from '@testing-library/react-native';

jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));

import { CategoryTagsPicker } from '../../components/ui/CategoryTagsPicker';

const customs = [
  { name: 'Subscriptions', color: '#D6336C' },
  { name: 'Pets', color: '#0CA678' },
];

describe('CategoryTagsPicker custom categories', () => {
  it('offers custom categories and picking one makes it the primary (first) tag', () => {
    const onChange = jest.fn();
    render(<CategoryTagsPicker tags={['Groceries']} onChange={onChange} customCategories={customs} />);
    expect(screen.getByText('Your categories')).toBeTruthy();
    fireEvent.press(screen.getByText('Subscriptions'));
    expect(onChange).toHaveBeenCalledWith(['Subscriptions', 'Groceries']);
  });

  it('hides a custom category already selected from the options and from the "Custom:" hint', () => {
    render(
      <CategoryTagsPicker tags={['Subscriptions', 'Groceries']} onChange={jest.fn()} customCategories={customs} />,
    );
    // selected chip + (not repeated) option row: Pets is the only remaining option
    expect(screen.getAllByText('Subscriptions')).toHaveLength(1);
    expect(screen.getByText('Pets')).toBeTruthy();
    expect(screen.queryByText(/^Custom:/)).toBeNull();
  });

  it('shows no section when there are no custom categories', () => {
    render(<CategoryTagsPicker tags={[]} onChange={jest.fn()} />);
    expect(screen.queryByText('Your categories')).toBeNull();
  });

  it('free-text custom tags still appear in the "Custom:" hint', () => {
    render(<CategoryTagsPicker tags={['Pet Food']} onChange={jest.fn()} customCategories={customs} />);
    expect(screen.getByText('Custom: Pet Food')).toBeTruthy();
  });
});
