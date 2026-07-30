export type RouteTarget = 'onboarding' | 'auth' | '(tabs)';

export type RouteState = {
  user: unknown;
  onboardingSeen: boolean;
};

export function pickTarget(s: RouteState): RouteTarget {
  if (!s.onboardingSeen) return 'onboarding';
  if (!s.user) return 'auth';
  return '(tabs)';
}

export function targetToHref(t: RouteTarget): string {
  switch (t) {
    case 'onboarding':
      return '/onboarding';
    case 'auth':
      return '/auth';
    case '(tabs)':
      return '/(tabs)';
  }
}
