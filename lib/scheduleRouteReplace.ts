/**
 * Imperative navigation after sign-out.
 *
 * Do NOT call `dismissAll` — popping the native stack while iOS is still
 * dismissing the Sign out UIAlertController deadlocks UINavigationController
 * and freezes the app. `replace` alone is enough once `user` is null.
 *
 * Do NOT wait on InteractionManager: Reanimated can keep "interactions"
 * pending forever, so the redirect never ran.
 *
 * Do NOT blindly retry `replace` once /auth is already showing: a second
 * replace mid-transition leaves react-native-screens with a painted
 * login screen that swallows every tap.
 */
export const AUTH_REDIRECT_RETRY_MS = 900;

export function scheduleRouteReplace(
  replace: () => void,
  isComplete?: () => boolean,
): () => void {
  let cancelled = false;
  const run = () => {
    if (cancelled || isComplete?.()) return;
    replace();
  };
  run();
  const retry = setTimeout(run, AUTH_REDIRECT_RETRY_MS);
  return () => {
    cancelled = true;
    clearTimeout(retry);
  };
}
