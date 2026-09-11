import React from 'react';
import { render, fireEvent, screen } from '@testing-library/react-native';
import { Button } from '../../../components/ui/Button';

describe('Button', () => {
  it('renders its label', () => {
    render(<Button label="Save" onPress={jest.fn()} />);
    expect(screen.getByText('Save')).toBeTruthy();
  });

  it('calls onPress when tapped', () => {
    const onPress = jest.fn();
    render(<Button label="Save" onPress={onPress} />);
    fireEvent.press(screen.getByText('Save'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('does not call onPress when disabled', () => {
    const onPress = jest.fn();
    render(<Button label="Save" onPress={onPress} disabled />);
    fireEvent.press(screen.getByText('Save'));
    expect(onPress).not.toHaveBeenCalled();
  });

  it('does not call onPress while loading, and hides the label', () => {
    const onPress = jest.fn();
    render(<Button label="Save" onPress={onPress} loading />);
    expect(screen.queryByText('Save')).toBeNull();
    expect(onPress).not.toHaveBeenCalled();
  });
});
