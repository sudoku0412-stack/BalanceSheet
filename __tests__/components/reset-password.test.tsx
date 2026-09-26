import React from 'react';
import { render, fireEvent, waitFor, screen } from '@testing-library/react-native';

const mockVerifyPasswordResetCode = jest.fn();
const mockConfirmPasswordReset = jest.fn();
let mockParams: { oobCode?: string } = { oobCode: 'oob-valid' };

jest.mock('expo-router', () => ({
  router: { replace: jest.fn(), back: jest.fn(), push: jest.fn() },
  useLocalSearchParams: () => mockParams,
}));

jest.mock('@react-native-firebase/auth', () => {
  const authFn = () => ({
    verifyPasswordResetCode: (...args: unknown[]) => mockVerifyPasswordResetCode(...args),
    confirmPasswordReset: (...args: unknown[]) => mockConfirmPasswordReset(...args),
  });
  return { __esModule: true, default: authFn };
});

const mockToastShow = jest.fn();
jest.mock('../../components/ui/Toast', () => ({
  useToast: () => ({ show: mockToastShow, dismiss: jest.fn() }),
}));

import ResetPasswordScreen from '../../app/reset-password';
import { router } from 'expo-router';

const mockReplace = router.replace as jest.Mock;

describe('ResetPasswordScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockParams = { oobCode: 'oob-valid' };
    mockVerifyPasswordResetCode.mockResolvedValue('jane@example.com');
    mockConfirmPasswordReset.mockResolvedValue(undefined);
  });

  it('shows a missing-code error when the deep link has no oobCode', async () => {
    mockParams = {};
    render(<ResetPasswordScreen />);
    await waitFor(() => {
      expect(
        screen.getByText('This reset link is missing its code — open it directly from the email.'),
      ).toBeTruthy();
    });
    expect(mockVerifyPasswordResetCode).not.toHaveBeenCalled();
  });

  it('rejects short passwords and mismatched confirmation without calling Firebase', async () => {
    render(<ResetPasswordScreen />);
    await waitFor(() => screen.getByText('Setting a new password for jane@example.com'));

    const [password, confirm] = screen.getAllByPlaceholderText('••••••••');
    fireEvent.changeText(password, 'short');
    fireEvent.changeText(confirm, 'short');
    fireEvent.press(screen.getByText('Set new password'));
    expect(screen.getByText('Password must be at least 8 characters.')).toBeTruthy();
    expect(mockConfirmPasswordReset).not.toHaveBeenCalled();

    fireEvent.changeText(password, 'longenough');
    fireEvent.changeText(confirm, 'doesnotmatch');
    fireEvent.press(screen.getByText('Set new password'));
    expect(screen.getByText('Passwords do not match.')).toBeTruthy();
    expect(mockConfirmPasswordReset).not.toHaveBeenCalled();
  });

  it('confirms the reset and returns to sign-in on a valid new password', async () => {
    render(<ResetPasswordScreen />);
    await waitFor(() => screen.getByText('Setting a new password for jane@example.com'));

    const [password, confirm] = screen.getAllByPlaceholderText('••••••••');
    fireEvent.changeText(password, 'newpass12');
    fireEvent.changeText(confirm, 'newpass12');
    fireEvent.press(screen.getByText('Set new password'));

    await waitFor(() => {
      expect(mockConfirmPasswordReset).toHaveBeenCalledWith('oob-valid', 'newpass12');
    });
    expect(mockToastShow).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'success' }),
    );
    expect(mockReplace).toHaveBeenCalledWith('/auth');
  });
});
