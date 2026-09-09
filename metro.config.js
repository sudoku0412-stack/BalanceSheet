const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// SDK53/RN0.79 turned on Metro's package.json "exports" field resolution
// by default. Several packages we depend on (expo-asset confirmed; likely
// others) ship an "exports" map that doesn't list their internal deep
// files, and Metro's exports resolution incorrectly applies to their OWN
// internal relative requires too (not just imports from outside the
// package) — breaks with "Unable to resolve module ./ExpoAsset" and
// similar. Known upstream issue (expo/expo#36588). Disabling until
// Metro's package-exports handling is fixed upstream.
config.resolver.unstable_enablePackageExports = false;

module.exports = config;
