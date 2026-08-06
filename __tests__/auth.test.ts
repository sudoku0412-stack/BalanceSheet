const mockUpdateProfile = jest.fn();
const mockSignInAnonymously = jest.fn();
const mockSignInWithCredential = jest.fn();
const mockSignOut = jest.fn();
const mockCredentialFn = jest.fn();
const mockAppleCredentialFn = jest.fn();

let mockCurrentUser: { updateProfile?: jest.Mock; delete?: jest.Mock } | null = null;

jest.mock('@react-native-firebase/auth', () => {
  const authFn = () => ({
    get currentUser() {
      return mockCurrentUser;
    },
    signInAnonymously: (...args: unknown[]) => mockSignInAnonymously(...args),
    signInWithCredential: (...args: unknown[]) => mockSignInWithCredential(...args),
    signOut: (...args: unknown[]) => mockSignOut(...args),
  });
  authFn.GoogleAuthProvider = { credential: (...args: unknown[]) => mockCredentialFn(...args) };
  authFn.AppleAuthProvider = { credential: (...args: unknown[]) => mockAppleCredentialFn(...args) };
  return { __esModule: true, default: authFn };
});

const mockAppleSignInAsync = jest.fn();

jest.mock('expo-apple-authentication', () => ({
  signInAsync: (...args: unknown[]) => mockAppleSignInAsync(...args),
  AppleAuthenticationScope: { FULL_NAME: 'FULL_NAME', EMAIL: 'EMAIL' },
}));

jest.mock('expo-crypto', () => ({
  randomUUID: () => 'raw-nonce',
  digestStringAsync: async () => 'hashed-nonce',
  CryptoDigestAlgorithm: { SHA256: 'SHA256' },
}));

const mockGoogleSignIn = jest.fn();
const mockGoogleSignOut = jest.fn();
const mockGetCurrentGoogleUser = jest.fn();
const mockHasPlayServices = jest.fn();
let isErrorWithCodeImpl = (e: unknown): e is { code: string } =>
  typeof e === 'object' && e !== null && 'code' in e;
let isSuccessResponseImpl = (r: unknown): boolean => (r as { type?: string })?.type === 'success';

jest.mock('@react-native-google-signin/google-signin', () => ({
  GoogleSignin: {
    hasPlayServices: (...args: unknown[]) => mockHasPlayServices(...args),
    signIn: (...args: unknown[]) => mockGoogleSignIn(...args),
    signOut: (...args: unknown[]) => mockGoogleSignOut(...args),
    getCurrentUser: (...args: unknown[]) => mockGetCurrentGoogleUser(...args),
    configure: jest.fn(),
  },
  isErrorWithCode: (e: unknown) => isErrorWithCodeImpl(e),
  isSuccessResponse: (r: unknown) => isSuccessResponseImpl(r),
  statusCodes: { SIGN_IN_CANCELLED: 'SIGN_IN_CANCELLED' },
}));

import {
  updateAuthDisplayName,
  signInWithGoogle,
  signInWithApple,
  deleteCurrentAccount,
  signOutEverywhere,
} from '../lib/auth';

beforeEach(() => {
  jest.clearAllMocks();
  mockCurrentUser = null;
  mockHasPlayServices.mockResolvedValue(true);
  isErrorWithCodeImpl = (e: unknown): e is { code: string } =>
    typeof e === 'object' && e !== null && 'code' in e;
  isSuccessResponseImpl = (r: unknown): boolean => (r as { type?: string })?.type === 'success';
});

describe('updateAuthDisplayName', () => {
  it('no-ops when not signed in', async () => {
    mockCurrentUser = null;
    await updateAuthDisplayName('New Name');
    expect(mockUpdateProfile).not.toHaveBeenCalled();
  });

  it('no-ops when displayName is blank/whitespace-only', async () => {
    mockCurrentUser = { updateProfile: mockUpdateProfile };
    await updateAuthDisplayName('   ');
    expect(mockUpdateProfile).not.toHaveBeenCalled();
  });

  it('calls updateProfile with the trimmed name otherwise', async () => {
    mockCurrentUser = { updateProfile: mockUpdateProfile };
    await updateAuthDisplayName('  Jane Doe  ');
    expect(mockUpdateProfile).toHaveBeenCalledWith({ displayName: 'Jane Doe' });
  });
});

describe('signInWithGoogle', () => {
  it('throws a normalized SIGN_IN_CANCELLED error when GoogleSignin.signIn throws a cancelled-code error', async () => {
    mockGoogleSignIn.mockRejectedValue({ code: 'SIGN_IN_CANCELLED' });
    await expect(signInWithGoogle()).rejects.toMatchObject({ code: 'SIGN_IN_CANCELLED' });
  });

  it('rethrows other errors from GoogleSignin.signIn unchanged', async () => {
    mockGoogleSignIn.mockRejectedValue({ code: 'SOME_OTHER_ERROR' });
    await expect(signInWithGoogle()).rejects.toMatchObject({ code: 'SOME_OTHER_ERROR' });
  });

  it('throws SIGN_IN_CANCELLED when the response is not a success response', async () => {
    mockGoogleSignIn.mockResolvedValue({ type: 'cancelled' });
    await expect(signInWithGoogle()).rejects.toMatchObject({ code: 'SIGN_IN_CANCELLED' });
  });

  it('throws when no idToken is returned on an otherwise-successful response', async () => {
    mockGoogleSignIn.mockResolvedValue({ type: 'success', data: {} });
    await expect(signInWithGoogle()).rejects.toThrow('No Google ID token returned.');
  });

  it('signs in with the credential when a valid idToken is returned', async () => {
    mockGoogleSignIn.mockResolvedValue({ type: 'success', data: { idToken: 'tok-123' } });
    mockCredentialFn.mockReturnValue({ mock: 'cred' });
    mockSignInWithCredential.mockResolvedValue({ user: { uid: 'u1' } });
    const user = await signInWithGoogle();
    expect(mockCredentialFn).toHaveBeenCalledWith('tok-123');
    expect(user).toEqual({ uid: 'u1' });
  });
});

describe('signInWithApple', () => {
  it('throws when no identityToken is returned', async () => {
    mockAppleSignInAsync.mockResolvedValue({ identityToken: null });
    await expect(signInWithApple()).rejects.toThrow('No Apple identity token returned.');
  });

  it('signs in with the credential using the raw (unhashed) nonce', async () => {
    mockAppleSignInAsync.mockResolvedValue({ identityToken: 'tok-123', fullName: null });
    mockAppleCredentialFn.mockReturnValue({ mock: 'cred' });
    mockSignInWithCredential.mockResolvedValue({ user: { uid: 'u1', displayName: null } });
    await signInWithApple();
    expect(mockAppleSignInAsync).toHaveBeenCalledWith(
      expect.objectContaining({ nonce: 'hashed-nonce' }),
    );
    expect(mockAppleCredentialFn).toHaveBeenCalledWith('tok-123', 'raw-nonce');
  });

  it('sets displayName from fullName on first sign-in (no existing displayName)', async () => {
    const updateProfile = jest.fn().mockResolvedValue(undefined);
    mockAppleSignInAsync.mockResolvedValue({
      identityToken: 'tok-123',
      fullName: { givenName: 'Jane', familyName: 'Doe' },
    });
    mockSignInWithCredential.mockResolvedValue({
      user: { uid: 'u1', displayName: null, updateProfile },
    });
    await signInWithApple();
    expect(updateProfile).toHaveBeenCalledWith({ displayName: 'Jane Doe' });
  });

  it('does not touch displayName on later sign-ins (Apple omits fullName)', async () => {
    const updateProfile = jest.fn();
    mockAppleSignInAsync.mockResolvedValue({ identityToken: 'tok-123', fullName: null });
    mockSignInWithCredential.mockResolvedValue({
      user: { uid: 'u1', displayName: null, updateProfile },
    });
    await signInWithApple();
    expect(updateProfile).not.toHaveBeenCalled();
  });

  it('propagates cancellation (ERR_REQUEST_CANCELED) unchanged', async () => {
    mockAppleSignInAsync.mockRejectedValue({ code: 'ERR_REQUEST_CANCELED' });
    await expect(signInWithApple()).rejects.toMatchObject({ code: 'ERR_REQUEST_CANCELED' });
  });
});

describe('deleteCurrentAccount', () => {
  it('throws when not signed in', async () => {
    mockCurrentUser = null;
    await expect(deleteCurrentAccount()).rejects.toThrow('Not signed in.');
  });

  it('deletes the account even when Google sign-out throws (best-effort)', async () => {
    const deleteFn = jest.fn().mockResolvedValue(undefined);
    mockCurrentUser = { delete: deleteFn };
    mockGetCurrentGoogleUser.mockRejectedValue(new Error('google unavailable'));
    await expect(deleteCurrentAccount()).resolves.toBeUndefined();
    expect(deleteFn).toHaveBeenCalled();
  });

  it('signs out of Google first when a Google user is present', async () => {
    const deleteFn = jest.fn().mockResolvedValue(undefined);
    mockCurrentUser = { delete: deleteFn };
    mockGetCurrentGoogleUser.mockResolvedValue({ id: 'g1' });
    mockGoogleSignOut.mockResolvedValue(undefined);
    await deleteCurrentAccount();
    expect(mockGoogleSignOut).toHaveBeenCalled();
    expect(deleteFn).toHaveBeenCalled();
  });
});

describe('signOutEverywhere', () => {
  it('signs out of firebase even when Google sign-out throws (best-effort)', async () => {
    mockGetCurrentGoogleUser.mockRejectedValue(new Error('google unavailable'));
    await expect(signOutEverywhere()).resolves.toBeUndefined();
    expect(mockSignOut).toHaveBeenCalled();
  });
});
