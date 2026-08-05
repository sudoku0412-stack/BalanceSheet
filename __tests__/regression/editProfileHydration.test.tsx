/**
 * Regression test — "Edit Profile not pre-filling" (app/edit-profile.tsx).
 *
 * Original failure mode: the first/last name and phone TextInputs were
 * seeded via `useState(profile?.field ?? '')`. That initial value is only
 * applied on the component's very first render. If `profile` from
 * AuthContext was still `null` at that exact mount moment (a common race —
 * profile loads asynchronously after sign-in), the fields locked in empty
 * forever: there was no re-sync once `profile` actually arrived, so the
 * screen showed only placeholder text even though the user had a saved
 * name/phone.
 *
 * Fix: a one-time hydration `useEffect` keyed on `profile` becoming
 * available, guarded by a ref so it fires exactly once and never clobbers
 * later user edits.
 *
 * This test renders the screen with `profile` initially null (simulating
 * the pre-load race), then flips the mocked useAuth() return value to a
 * populated profile and re-renders — asserting the inputs end up
 * populated. Against the original buggy code (no hydration effect) this
 * would fail: the inputs would remain empty after the update.
 */
import React from 'react';
import { render } from '@testing-library/react-native';

const mockBack = jest.fn();
jest.mock('expo-router', () => ({
  router: { back: jest.fn() },
}));

let mockAuthValue: any;
jest.mock('../../lib/AuthContext', () => ({
  useAuth: () => mockAuthValue,
}));

jest.mock('../../lib/database', () => ({
  getCurrentHouseholdId: () => 'hh-1',
  setCurrentHouseholdId: jest.fn(),
}));

jest.mock('../../lib/phoneVerification', () => ({
  setPhoneNumberManual: jest.fn(),
  removePhoneVerification: jest.fn(),
}));

jest.mock('@expo/vector-icons', () => ({
  Ionicons: () => null,
}));

import EditProfileScreen from '../../app/edit-profile';

describe('Regression: Edit Profile hydration race (app/edit-profile.tsx)', () => {
  it('populates fields once profile arrives after an initially-null mount', () => {
    mockAuthValue = {
      user: { uid: 'u1' },
      profile: null,
      updateProfileName: jest.fn(),
      refreshProfile: jest.fn(),
    };

    const { getByPlaceholderText, rerender } = render(<EditProfileScreen />);

    // Mount happened with profile === null — fields must start empty.
    expect(getByPlaceholderText('Jane').props.value).toBe('');
    expect(getByPlaceholderText('Doe').props.value).toBe('');
    expect(getByPlaceholderText('+1 416 555 1234').props.value).toBe('');

    // Simulate the async profile load completing.
    mockAuthValue = {
      ...mockAuthValue,
      profile: {
        uid: 'u1',
        firstName: 'Alex',
        lastName: 'Rivera',
        phone: '+14165551234',
        phoneVerified: true,
      },
    };
    rerender(<EditProfileScreen />);

    expect(getByPlaceholderText('Jane').props.value).toBe('Alex');
    expect(getByPlaceholderText('Doe').props.value).toBe('Rivera');
    expect(getByPlaceholderText('+1 416 555 1234').props.value).toBe('+14165551234');
  });
});
