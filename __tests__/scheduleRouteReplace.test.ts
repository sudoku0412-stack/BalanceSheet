import { AUTH_REDIRECT_RETRY_MS, scheduleRouteReplace } from '../lib/scheduleRouteReplace';

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

  it('skips the retry once the guard reports the destination is showing', () => {
    const replace = jest.fn();
    let complete = false;
    scheduleRouteReplace(replace, () => complete);
    expect(replace).toHaveBeenCalledTimes(1);
    complete = true;
    jest.advanceTimersByTime(AUTH_REDIRECT_RETRY_MS);
    expect(replace).toHaveBeenCalledTimes(1);
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
