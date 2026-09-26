/**
 * Imperative navigation after sign-out. `router.replace` alone is
 * unreliable on iOS native-stack when Settings is a pushed screen and
 * a UIAlertController is dismissing — dismiss the stack first, then
 * replace. Callers also retry this after a short delay.
 */
export type SignedOutRouter = {
  canDismiss?: () => boolean;
  dismissAll?: () => void;
  replace: (href: string) => void;
};

export function replaceSignedOutRoute(r: SignedOutRouter, href: string): void {
  try {
    if (r.canDismiss?.()) {
      r.dismissAll?.();
    }
  } catch {
    // Native stack can throw if the alert is still presented.
  }
  r.replace(href);
}

export const AUTH_REDIRECT_RETRY_MS = 400;

export function scheduleRouteReplace(replace: () => void): () => void {
  let cancelled = false;
  const run = () => {
    if (!cancelled) replace();
  };
  // Fire now — do not wait on InteractionManager. Reanimated (tab bar,
  // gestures) can keep "interactions" pending forever on iOS, which
  // previously delayed the only replace until after cleanup cancelled it.
  run();
  const retry = setTimeout(run, AUTH_REDIRECT_RETRY_MS);
  return () => {
    cancelled = true;
    clearTimeout(retry);
  };
}
