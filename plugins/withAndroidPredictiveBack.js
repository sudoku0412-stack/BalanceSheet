const { withAndroidManifest, AndroidConfig } = require('@expo/config-plugins');

/**
 * Sets android:enableOnBackInvokedCallback="true" on the <application>
 * tag of the generated AndroidManifest.xml.
 *
 * This project targets API 36 (see app.config.js's
 * expo-build-properties android.targetSdkVersion), and for apps
 * targeting API 33+ that flag defaults to false unless set explicitly.
 * With it false, Android falls back to legacy back-key dispatch instead
 * of the modern OnBackInvokedCallback API — swipe-from-edge navigation
 * still works (the OS still turns the gesture into a back-key event),
 * but the app gets none of the predictive-back preview/animation, and
 * Google Play has been flagging this as a "not opted in" warning ahead
 * of a future requirement. It's a real gap worth closing, but on its
 * own it does NOT explain a back-swipe that fails to navigate at all —
 * see the hitSlop fix on the Swipeable rows in history.tsx/households.tsx
 * for that.
 *
 * Expo SDK 54 added a first-class `android.predictiveBackGestureEnabled`
 * app.config.js property that does this for you (expo/expo#38774). This
 * project is still on SDK 53 (see package.json's "expo" version), where
 * that property doesn't exist in the config schema yet — hence a small
 * hand-written config plugin instead, same pattern as
 * plugins/withGooglePlayAdiToken.js and plugins/withGradleJvmHeap.js.
 * Safe to delete once this repo upgrades to SDK 54+ in favor of the
 * built-in property.
 */
module.exports = function withAndroidPredictiveBack(config) {
  return withAndroidManifest(config, (cfg) => {
    const application = AndroidConfig.Manifest.getMainApplicationOrThrow(
      cfg.modResults,
    );
    application.$['android:enableOnBackInvokedCallback'] = 'true';
    return cfg;
  });
};
