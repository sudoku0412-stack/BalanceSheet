import { InteractionManager } from 'react-native';

/**
 * iOS UIAlertController (the Sign out confirm sheet) is still dismissing
 * when auth state flips to signed-out. A `router.replace('/auth')` in
 * that same turn is often swallowed by the native stack and never
 * retried, so the user stays on Settings with a dead session.
 *
 * Run the replace after interactions, then once more after the alert
 * animation window, so a swallowed first attempt still lands on /auth.
 */
export const AUTH_REDIRECT_RETRY_MS = 400;

export function scheduleRouteReplace(replace: () => void): () => void {
  let cancelled = false;
  const run = () => {
    if (!cancelled) replace();
  };
  const task = InteractionManager.runAfterInteractions(run);
  const retry = setTimeout(run, AUTH_REDIRECT_RETRY_MS);
  return () => {
    cancelled = true;
    task.cancel?.();
    clearTimeout(retry);
  };
}
