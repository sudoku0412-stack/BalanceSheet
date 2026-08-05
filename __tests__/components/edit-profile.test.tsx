import React from 'react';
import { render, fireEvent, waitFor, screen } from '@testing-library/react-native';

// NOTE: jest.mock factories for `expo-router`/`lib/database`/`lib/phoneVerification`
// below return plain object literals directly (not wrapped in a function), and
// those factories run EAGERLY the moment the module is first required — which,
// thanks to ES import hoisting, can happen before any `const mock... = jest.fn()`
// declared earlier in this file's source has actually been assigned. So those
// mocks build their jest.fn()s inline and we recover references to them
// afterwards via the (now-mocked) module's exports, rather than closing over
// an outer const. Mocks like AuthContext/Toast below are safe to reference via
// outer consts because they're wrapped in a `() => ({...})` function that only
// runs later, at render time (React hook call), by which point everything in
// this file has finished initializing.

const mockUpdateProfileName = jest.fn(async () => {});
const mockRefreshProfile = jest.fn(async () => {});
const mockToastShow = jest.fn();

jest.mock('expo-router', () => ({
  router: { back: jest.fn(), push: jest.fn(), replace: jest.fn() },
}));

jest.mock('@expo/vector-icons', () => ({
  Ionicons: () => null,
}));

jest.mock('../../lib/AuthContext', () => ({
  useAuth: () => ({
    user: { uid: 'u1' },
    profile: { firstName: 'Jane', lastName: 'Doe', phone: null },
    updateProfileName: mockUpdateProfileName,
    refreshProfile: mockRefreshProfile,
  }),
}));

jest.mock('../../lib/phoneVerification', () => ({
  setPhoneNumberManual: jest.fn(async () => ({ joinedHouseholdId: null })),
  removePhoneVerification: jest.fn(async () => {}),
}));

jest.mock('../../lib/database', () => ({
  getCurrentHouseholdId: jest.fn(async () => null),
  setCurrentHouseholdId: jest.fn(),
}));

jest.mock('../../components/ui/Toast', () => ({
  useToast: () => ({ show: mockToastShow, dismiss: jest.fn() }),
}));

import EditProfileScreen from '../../app/edit-profile';
import { router } from 'expo-router';

const mockBack = router.back as jest.Mock;

describe('EditProfileScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders first/last name/phone fields prefilled from profile', () => {
    render(<EditProfileScreen />);
    expect(screen.getByDisplayValue('Jane')).toBeTruthy();
    expect(screen.getByDisplayValue('Doe')).toBeTruthy();
  });

  it('updates the first name input when typed into', () => {
    render(<EditProfileScreen />);
    const input = screen.getByDisplayValue('Jane');
    fireEvent.changeText(input, 'Janet');
    expect(screen.getByDisplayValue('Janet')).toBeTruthy();
  });

  it('shows a name error and does not save when first name is empty', async () => {
    render(<EditProfileScreen />);
    const input = screen.getByDisplayValue('Jane');
    fireEvent.changeText(input, '');
    fireEvent.press(screen.getByText('Save'));

    await waitFor(() => {
      expect(screen.getByText('Name is required.')).toBeTruthy();
    });
    expect(mockUpdateProfileName).not.toHaveBeenCalled();
  });

  it('shows a phone error and does not proceed with a valid name but invalid phone', async () => {
    render(<EditProfileScreen />);
    const phoneInput = screen.getByPlaceholderText('+1 416 555 1234');
    fireEvent.changeText(phoneInput, 'not-a-phone');
    fireEvent.press(screen.getByText('Save'));

    await waitFor(() => {
      expect(screen.getByText('Enter a valid phone number, e.g. +1 416 555 1234.')).toBeTruthy();
    });
    expect(mockUpdateProfileName).not.toHaveBeenCalled();
  });

  it('saves successfully with valid everything: updates name, goes back, shows toast', async () => {
    render(<EditProfileScreen />);
    fireEvent.press(screen.getByText('Save'));

    await waitFor(() => {
      expect(mockUpdateProfileName).toHaveBeenCalledWith('Jane', 'Doe');
    });
    await waitFor(() => {
      expect(mockBack).toHaveBeenCalled();
    });
    expect(mockToastShow).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'success', message: 'Profile updated' })
    );
  });
});
