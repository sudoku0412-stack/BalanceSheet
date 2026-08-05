import React from 'react';
import { render, fireEvent, waitFor, screen } from '@testing-library/react-native';

// NOTE: the expo-router mock returns a plain object literal, which runs
// eagerly at first require (before an outer `const mock... = jest.fn()`
// in this file would be assigned, thanks to ES import hoisting) — so its
// jest.fn()s are created inline and recovered afterwards via the (now
// mocked) module's exports. useAuth is safe to close over an outer const
// since it's wrapped in a function only invoked later at render time.
const mockMarkOnboardingSeen = jest.fn(async () => {});

jest.mock('expo-router', () => ({
  router: { replace: jest.fn(), back: jest.fn(), push: jest.fn() },
}));

jest.mock('@expo/vector-icons', () => ({
  Ionicons: () => null,
}));

jest.mock('../../lib/AuthContext', () => ({
  useAuth: () => ({ markOnboardingSeen: mockMarkOnboardingSeen }),
}));

import OnboardingScreen from '../../app/onboarding';
import { router } from 'expo-router';

const mockReplace = router.replace as jest.Mock;

describe('OnboardingScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("renders the first slide's title/body and a Skip button", () => {
    render(<OnboardingScreen />);
    expect(screen.getByText("Snap a receipt, we'll do the rest")).toBeTruthy();
    expect(
      screen.getByText(
        'Point your camera at any receipt — amount, merchant and category are captured instantly.',
      ),
    ).toBeTruthy();
    expect(screen.getByText('Skip')).toBeTruthy();
  });

  it('tapping Skip marks onboarding seen and redirects to /auth', async () => {
    render(<OnboardingScreen />);
    fireEvent.press(screen.getByText('Skip'));

    await waitFor(() => {
      expect(mockMarkOnboardingSeen).toHaveBeenCalled();
    });
    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith('/auth');
    });
  });

  it('shows "Next" as the CTA on the first (non-last) slide', () => {
    render(<OnboardingScreen />);
    expect(screen.getByText('Next')).toBeTruthy();
    expect(screen.queryByText('Get Started')).toBeNull();
  });
});
