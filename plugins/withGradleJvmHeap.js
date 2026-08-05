const { withGradleProperties } = require('@expo/config-plugins');

/**
 * EAS local-build runners default to a 2GB Gradle daemon heap, which
 * isn't enough once R8/resource shrinking is enabled on release builds
 * (`app.config.js`'s expo-build-properties android block) — R8 OOM'd
 * mid-build (`java.lang.OutOfMemoryError: Java heap space` on
 * `:app:minifyReleaseWithR8`). Raise it explicitly instead of relying
 * on the runner's default.
 */
module.exports = function withGradleJvmHeap(config) {
  return withGradleProperties(config, (cfg) => {
    const key = 'org.gradle.jvmargs';
    const value = '-Xmx4096m -XX:MaxMetaspaceSize=1024m';
    const existing = cfg.modResults.find(
      (item) => item.type === 'property' && item.key === key,
    );
    if (existing) {
      existing.value = value;
    } else {
      cfg.modResults.push({ type: 'property', key, value });
    }
    return cfg;
  });
};
