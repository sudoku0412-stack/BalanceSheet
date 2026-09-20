/**
 * Regression guard for a real bug: a manual `git pull` + Xcode Archive
 * (no `eas build`, no EAS env var injection) baked `undefined` into both
 * RevenueCat keys, and lib/entitlements.ts's configurePurchases silently
 * no-ops on that — so the paywall just showed no plans, on a build that
 * otherwise looked completely normal. These keys are public-by-design
 * RevenueCat SDK keys (safe to hardcode client-side), so app.config.js
 * now falls back to a literal value whenever the env var isn't set.
 * This test pins that fallback so it can't be silently dropped again.
 */
describe('app.config.js RevenueCat key fallback', () => {
  const ENV_KEYS = ['REVENUECAT_API_KEY_ANDROID', 'REVENUECAT_API_KEY_IOS'] as const;
  let originalEnv: Record<string, string | undefined>;

  beforeEach(() => {
    originalEnv = {};
    for (const key of ENV_KEYS) {
      originalEnv[key] = process.env[key];
      delete process.env[key];
    }
    jest.resetModules();
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (originalEnv[key] === undefined) delete process.env[key];
      else process.env[key] = originalEnv[key];
    }
  });

  it('falls back to a hardcoded key for both platforms when no env var is set', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const configFn = require('../app.config.js');
    const { extra } = configFn({ config: {} });

    expect(extra.revenueCatApiKeyAndroid).toBe('goog_LUmSeXyOBnDtiRDjxocSgYvmrRN');
    expect(extra.revenueCatApiKeyIos).toBe('appl_IWUzaIJgGCmISLeoYdTuzjQNJxc');
    // Neither fallback is empty/undefined — that's the exact failure mode this guards against.
    expect(extra.revenueCatApiKeyAndroid).toBeTruthy();
    expect(extra.revenueCatApiKeyIos).toBeTruthy();
  });

  it('still prefers the env var over the fallback when EAS sets one', () => {
    process.env.REVENUECAT_API_KEY_ANDROID = 'goog_from_eas_env';
    process.env.REVENUECAT_API_KEY_IOS = 'appl_from_eas_env';
    jest.resetModules();

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const configFn = require('../app.config.js');
    const { extra } = configFn({ config: {} });

    expect(extra.revenueCatApiKeyAndroid).toBe('goog_from_eas_env');
    expect(extra.revenueCatApiKeyIos).toBe('appl_from_eas_env');
  });
});
