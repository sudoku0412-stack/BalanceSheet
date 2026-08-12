/** Bounds a promise so a dropped connection or backend hang can't leave
 *  a caller's "saving"/"loading" state stuck true forever with no error
 *  and no recovery. Whichever settles first — the real promise or the
 *  timeout — wins; the timer is always cleared either way. */
export function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  message = 'Request timed out — check your connection and try again.',
): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer)) as Promise<T>;
}
