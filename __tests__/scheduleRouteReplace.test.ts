import {
  AUTH_REDIRECT_RETRY_MS,
  replaceSignedOutRoute,
  scheduleRouteReplace,
} from '../lib/scheduleRouteReplace';

describe('replaceSignedOutRoute', () => {
  it('dismisses the stack then replaces so Settings is not left on top', () => {
    const r = {
      canDismiss: jest.fn(() => true),
      dismissAll: jest.fn(),
      replace: jest.fn(),
    };
    replaceSignedOutRoute(r, '/auth');
    expect(r.dismissAll).toHaveBeenCalled();
    expect(r.replace).toHaveBeenCalledWith('/auth');
  });

  it('still replaces when the stack cannot dismiss', () => {
    const r = {
      canDismiss: jest.fn(() => false),
      dismissAll: jest.fn(),
      replace: jest.fn(),
    };
    replaceSignedOutRoute(r, '/auth');
    expect(r.dismissAll).not.toHaveBeenCalled();
    expect(r.replace).toHaveBeenCalledWith('/auth');
  });

  it('still replaces when dismissAll throws (iOS alert still up)', () => {
    const r = {
      canDismiss: jest.fn(() => true),
      dismissAll: jest.fn(() => {
        throw new Error('native');
      }),
      replace: jest.fn(),
    };
    expect(() => replaceSignedOutRoute(r, '/auth')).not.toThrow();
    expect(r.replace).toHaveBeenCalledWith('/auth');
  });
});

describe('scheduleRouteReplace', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('runs the replace immediately and retries after the alert window', () => {
    const replace = jest.fn();
    scheduleRouteReplace(replace);
    expect(replace).toHaveBeenCalledTimes(1);
    jest.advanceTimersByTime(AUTH_REDIRECT_RETRY_MS);
    expect(replace).toHaveBeenCalledTimes(2);
  });

  it('does not fire a swallowed retry after cleanup', () => {
    const replace = jest.fn();
    const cleanup = scheduleRouteReplace(replace);
    expect(replace).toHaveBeenCalledTimes(1);
    cleanup();
    jest.advanceTimersByTime(AUTH_REDIRECT_RETRY_MS);
    expect(replace).toHaveBeenCalledTimes(1);
  });
});
