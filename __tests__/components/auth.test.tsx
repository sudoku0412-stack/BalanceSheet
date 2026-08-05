import React from 'react';
import { render, fireEvent, waitFor, screen } from '@testing-library/react-native';

// NOTE: the expo-router mock returns a plain object literal, which runs
// eagerly at first require (before an outer `const mock... = jest.fn()`
// in this file would be assigned, thanks to ES import hoisting) — so its
// jest.fn()s are created inline and recovered afterwards via the (now
// mocked) module's exports. lib/AuthContext's useAuth is safe to close
// over an outer const since it's wrapped in a function only invoked
// later at render time.
const mockEnsureProfile = jest.fn(async () => {});

jest.mock('expo-router', () => ({
  router: { replace: jest.fn(), back: jest.fn(), push: jest.fn() },
}));

jest.mock('@expo/vector-icons', () => ({
  Ionicons: () => null,
}));

jest.mock('../../lib/AuthContext', () => ({
  useAuth: () => ({ ensureProfile: mockEnsureProfile }),
}));

jest.mock('../../lib/auth', () => ({
  sendPasswordReset: jest.fn(),
  signInAsGuest: jest.fn(),
  signInWithEmail: jest.fn(),
  signInWithGoogle: jest.fn(),
  signUpWithEmail: jest.fn(),
}));

import AuthScreen from '../../app/auth';
import {
  signInWithEmail,
  signUpWithEmail,
} from '../../lib/auth';

const mockSignInWithEmail = signInWithEmail as jest.Mock;
const mockSignUpWithEmail = signUpWithEmail as jest.Mock;

describe('AuthScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders the email/password fields for the default Log In tab', () => {
    render(<AuthScreen />);
    expect(screen.getByText('Welcome back')).toBeTruthy();
    expect(screen.getByPlaceholderText('you@email.com')).toBeTruthy();
    expect(screen.getByPlaceholderText('••••••••')).toBeTruthy();
    expect(screen.getAllByText('Log In').length).toBeGreaterThan(0);
  });

  it('typing credentials and submitting calls signInWithEmail', async () => {
    mockSignInWithEmail.mockResolvedValue(undefined);
    render(<AuthScreen />);

    fireEvent.changeText(screen.getByPlaceholderText('you@email.com'), 'jane@example.com');
    fireEvent.changeText(screen.getByPlaceholderText('••••••••'), 'secret123');
    fireEvent.press(screen.getAllByText('Log In')[1]);

    await waitFor(() => {
      expect(mockSignInWithEmail).toHaveBeenCalledWith('jane@example.com', 'secret123');
    });
  });

  it('surfaces a humanized error message when sign-in is rejected', async () => {
    mockSignInWithEmail.mockRejectedValue({ code: 'auth/wrong-password' });
    render(<AuthScreen />);

    fireEvent.changeText(screen.getByPlaceholderText('you@email.com'), 'jane@example.com');
    fireEvent.changeText(screen.getByPlaceholderText('••••••••'), 'wrongpass');
    fireEvent.press(screen.getAllByText('Log In')[1]);

    await waitFor(() => {
      expect(mockSignInWithEmail).toHaveBeenCalled();
    });
    // humanizeAuthError is used unmocked (real, already unit-tested) — the
    // exact copy for auth/wrong-password is "Incorrect email or password."
    await waitFor(() => {
      expect(screen.getByText('Incorrect email or password.')).toBeTruthy();
    });
  });

  it('toggling to Sign Up changes the headline, CTA label, and requires full name', async () => {
    render(<AuthScreen />);
    fireEvent.press(screen.getByText('Sign Up'));

    expect(screen.getByText('Create your account')).toBeTruthy();
    expect(screen.getByText('Create Account')).toBeTruthy();
    expect(screen.getByPlaceholderText('Jane Doe')).toBeTruthy();

    fireEvent.changeText(screen.getByPlaceholderText('you@email.com'), 'new@example.com');
    fireEvent.changeText(screen.getAllByPlaceholderText('••••••••')[0], 'password1');
    fireEvent.changeText(screen.getAllByPlaceholderText('••••••••')[1], 'password1');
    fireEvent.press(screen.getByText('Create Account'));

    await waitFor(() => {
      expect(screen.getByText('Full name is required.')).toBeTruthy();
    });
    expect(mockSignUpWithEmail).not.toHaveBeenCalled();
  });
});
