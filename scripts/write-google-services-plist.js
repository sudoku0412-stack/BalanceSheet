/**
 * EAS Build npm hook (runs as "eas-build-post-install", after `npm install`
 * on the remote builder, before pod install / xcodebuild).
 *
 * ios/ is a checked-in bare-workflow Xcode project, so Expo's own
 * `googleServicesFile` config-plugin mechanism (which normally writes this
 * from the GOOGLE_SERVICES_PLIST EAS env var during prebuild) never runs —
 * no prebuild happens for iOS here. Uploading the gitignored file as part
 * of the EAS_NO_VCS build archive was unreliable (see release-build.yml's
 * iOS job), so this writes it directly on the builder instead, sidestepping
 * the archive entirely.
 */
const fs = require('fs');
const path = require('path');

const content = process.env.GOOGLE_SERVICES_PLIST;
if (!content) {
  console.log('[eas-build-post-install] GOOGLE_SERVICES_PLIST not set — skipping (expected outside EAS Build).');
  process.exit(0);
}

const dest = path.join(__dirname, '..', 'ios', 'ReceiptScanner', 'GoogleService-Info.plist');
fs.writeFileSync(dest, content);
console.log(`[eas-build-post-install] Wrote ${dest}`);
