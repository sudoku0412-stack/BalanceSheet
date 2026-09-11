import React from 'react';
import { render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';
import { Card } from '../../../components/ui/Card';

describe('Card', () => {
  it('renders its children', () => {
    render(
      <Card>
        <Text>Card content</Text>
      </Card>,
    );
    expect(screen.getByText('Card content')).toBeTruthy();
  });

  it('applies a stronger shadow when elevated', () => {
    render(
      <Card elevated>
        <Text>Elevated</Text>
      </Card>,
    );
    expect(screen.getByText('Elevated')).toBeTruthy();
  });
});
