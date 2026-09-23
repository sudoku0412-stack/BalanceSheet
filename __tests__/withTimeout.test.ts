import { withTimeout } from '../lib/withTimeout';

describe('withTimeout', () => {
  it('resolves with the original value when the promise settles before the timeout', async () => {
    const result = await withTimeout(Promise.resolve('ok'), 1000);
    expect(result).toBe('ok');
  });

  it('rejects with the original error when the promise rejects before the timeout', async () => {
    await expect(withTimeout(Promise.reject(new Error('boom')), 1000)).rejects.toThrow('boom');
  });

  it('rejects with a timeout error when the promise never settles', async () => {
    jest.useFakeTimers();
    try {
      const neverSettles = new Promise(() => {});
      const race = withTimeout(neverSettles, 1000);
      const assertion = expect(race).rejects.toThrow(
        'Request timed out — check your connection and try again.',
      );
      jest.advanceTimersByTime(1000);
      await assertion;
    } finally {
      jest.useRealTimers();
    }
  });

  it('supports a custom timeout message', async () => {
    jest.useFakeTimers();
    try {
      const neverSettles = new Promise(() => {});
      const race = withTimeout(neverSettles, 500, 'Custom timeout message');
      const assertion = expect(race).rejects.toThrow('Custom timeout message');
      jest.advanceTimersByTime(500);
      await assertion;
    } finally {
      jest.useRealTimers();
    }
  });

  it('clears the timer once the underlying promise wins the race, avoiding a dangling timer', async () => {
    jest.useFakeTimers();
    try {
      const clearSpy = jest.spyOn(global, 'clearTimeout');
      await withTimeout(Promise.resolve('fast'), 1000);
      expect(clearSpy).toHaveBeenCalled();
      clearSpy.mockRestore();
    } finally {
      jest.useRealTimers();
    }
  });

  it('does not reject with the timeout error once the real promise has already resolved', async () => {
    jest.useFakeTimers();
    try {
      const result = await withTimeout(Promise.resolve('done'), 1000);
      expect(result).toBe('done');
      // Advancing past the timeout afterwards must not surface a stray rejection.
      jest.advanceTimersByTime(2000);
    } finally {
      jest.useRealTimers();
    }
  });
});
