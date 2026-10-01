import { tr } from './i18n';
export function humanizeAuthError(e: unknown): string {
  const code: string | undefined = (e as { code?: string })?.code;
  switch (code) {
    case 'auth/invalid-email':
      return tr('authInvalidEmail');
    case 'auth/user-not-found':
    case 'auth/wrong-password':
    case 'auth/invalid-credential':
      return tr('authBadCredentials');
    case 'auth/email-already-in-use':
      return tr('authEmailInUse');
    case 'auth/weak-password':
      return tr('authWeakPassword');
    case 'auth/too-many-requests':
      return tr('authTooMany');
    case 'auth/invalid-phone-number':
      return tr('authInvalidPhone');
    case 'auth/invalid-verification-code':
      return tr('authBadCode');
    case 'auth/network-request-failed':
      return tr('authNetwork');
    default:
      return (e as { message?: string })?.message ?? tr('somethingWentWrongTryAgain');
  }
}
