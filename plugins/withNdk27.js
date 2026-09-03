const { withProjectBuildGradle } = require('@expo/config-plugins');

const OLD_NDK_VERSION = '26.1.10909125';
const NEW_NDK_VERSION = '27.1.12297006';

/**
 * Expo SDK 52's own prebuild-config ships a plugin
 * (@expo/prebuild-config/build/plugins/sdk52/ReactNative77CompatPlugin.js)
 * that bumps the generated android/build.gradle's ndkVersion from
 * 26.1.10909125 to exactly this same 27.1.12297006 — but only when
 * react-native >= 0.77.0. This app is still on react-native 0.76.5, so
 * that plugin's version gate skips it, and the build silently keeps
 * using NDK 26.1 (confirmed in CI logs) despite trying to override it
 * via expo-build-properties (which has no `ndkVersion` option at all —
 * see its PluginConfigTypeAndroid type). NDK 26.1 predates 16 KB memory
 * page alignment (Google Play policy, enforced since Oct 31 2025;
 * flagged in Play Console's Policy status), which is the actual reason
 * this plugin exists: apply the exact same patch Expo's own compat
 * plugin would, minus the react-native-version gate.
 *
 * That root `ext.ndkVersion` replace alone isn't enough, though — it
 * only takes effect for modules whose OWN build.gradle explicitly
 * references `rootProject.ext.ndkVersion` (react-native's own module,
 * and the app module itself, both via the RN gradle plugin template).
 * Expo modules with native code (confirmed via CI logs: expo-sqlite,
 * and by extension likely others) don't reference that at all — they
 * just fall back to whatever NDK version AGP itself defaults to when
 * a module's `android {}` block never sets `ndkVersion` explicitly
 * (AGP 8.6.0's own bundled default happens to be the same old 26.1).
 * The `subprojects` block below forces EVERY module's `android.ndkVersion`
 * after the fact, closing that gap for modules we don't control.
 */
const FORCE_NDK_BLOCK_MARKER = '// withNdk27: force every module onto the same NDK';

module.exports = function withNdk27(config) {
  return withProjectBuildGradle(config, (cfg) => {
    if (cfg.modResults.language !== 'groovy') {
      throw new Error('withNdk27: expected android/build.gradle to be Groovy, not Kotlin — update this plugin.');
    }
    if (!cfg.modResults.contents.includes(OLD_NDK_VERSION)) {
      // Expo's own SDK52 compat plugin may have already patched this
      // (react-native was upgraded past 0.77.0) or the template
      // changed — either way, don't silently no-op forever.
      throw new Error(
        `withNdk27: expected to find ndkVersion '${OLD_NDK_VERSION}' in android/build.gradle to replace — it wasn't there. Remove this plugin (or update NEW_NDK_VERSION) if the underlying template already sets a newer NDK.`,
      );
    }
    cfg.modResults.contents = cfg.modResults.contents.replace(
      new RegExp(`(ndkVersion\\s*=\\s*['"])${OLD_NDK_VERSION}(['"])`, 'g'),
      `$1${NEW_NDK_VERSION}$2`,
    );
    if (!cfg.modResults.contents.includes(FORCE_NDK_BLOCK_MARKER)) {
      cfg.modResults.contents += `
${FORCE_NDK_BLOCK_MARKER} (rootProject.ext.ndkVersion alone only
// reaches modules whose own build.gradle explicitly reads it — see
// plugins/withNdk27.js for why this exists).
subprojects { subproject ->
    afterEvaluate {
        if (subproject.hasProperty('android')) {
            subproject.android.ndkVersion = "${NEW_NDK_VERSION}"
        }
    }
}
`;
    }
    return cfg;
  });
};
