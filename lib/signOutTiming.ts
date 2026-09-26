import { Platform } from 'react-native';

/** Wait after the confirm alert before mutating the stack / native auth. */
export const IOS_ALERT_SETTLE_MS = 500;

/**
 * After local session is cleared and /auth is showing, wait before
 * GIDSignIn / Firebase / RevenueCat native sign-out. Those calls share
 * the iOS main thread with UINavigationController; running them in the
 * same turn as `router.replace` leaves the login screen painted but
 * untouchable.
 */
export const NATIVE_SIGNOUT_DEFER_MS = Platform.OS === 'ios' ? 700 : 0;
