import { InteractionManager } from 'react-native';
import { AUTH_REDIRECT_RETRY_MS, scheduleRouteReplace } from '../lib/scheduleRouteReplace';

jest.mock('react-native', () => ({
  InteractionManager: {
    runAfterInteractions: jest.fn((cb: () => void) => {
      cb();
      return { cancel: jest.fn() };
    }),
  },
}));

describe('scheduleRouteReplace', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('runs the replace after interactions and retries after the alert window', () => {
    const replace = jest.fn();
    const runAfter = InteractionManager.runAfterInteractions as jest.Mock;
    runAfter.mockImplementation(() => ({ cancel: jest.fn() }));

    scheduleRouteReplace(replace);

    expect(replace).not.toHaveBeenCalled();
    const afterCb = runAfter.mock.calls[0][0] as () => void;
    afterCb();
    expect(replace).toHaveBeenCalledTimes(1);

    jest.advanceTimersByTime(AUTH_REDIRECT_RETRY_MS);
    expect(replace).toHaveBeenCalledTimes(2);
  });

  it('does not fire a swallowed retry after cleanup', () => {
    const replace = jest.fn();
    const cancel = jest.fn();
    (InteractionManager.runAfterInteractions as jest.Mock).mockImplementation(() => ({ cancel }));

    const cleanup = scheduleRouteReplace(replace);
    cleanup();

    jest.advanceTimersByTime(AUTH_REDIRECT_RETRY_MS);
    expect(replace).not.toHaveBeenCalled();
    expect(cancel).toHaveBeenCalled();
  });
});
