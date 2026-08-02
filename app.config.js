const withGooglePlayAdiToken = require('./plugins/withGooglePlayAdiToken');

module.exports = ({ config }) => {
  return withGooglePlayAdiToken({
    ...config,
    name: 'Receipt Scanner',
    slug: 'receipt-scanner',
    version: '1.0.0',
    runtimeVersion: { policy: 'appVersion' },
    updates: {
      url: 'https://u.expo.dev/bbdefab5-4cc5-4480-96a9-8ece7eb913a5',
      fallbackToCacheTimeout: 0,
    },
    orientation: 'portrait',
    icon: './assets/icon.png',
    userInterfaceStyle: 'dark',
    splash: {
      image: './assets/splash.png',
      resizeMode: 'contain',
      backgroundColor: '#0F172A',
    },
    ios: {
      supportsTablet: false,
      bundleIdentifier: 'com.kaushikmajumder.receiptscanner',
      googleServicesFile: process.env.GOOGLE_SERVICES_PLIST ?? './GoogleService-Info.plist',
      infoPlist: {
        NSCameraUsageDescription: 'ReceiptScanner needs camera access to scan receipts.',
        NSPhotoLibraryUsageDescription:
          'ReceiptScanner needs photo library access to import receipts.',
        NSFaceIDUsageDescription: 'Use Face ID to quickly and securely unlock ReceiptScanner.',
      },
      // Phase 3 magic-link invites: an invite email arrives with a
      // link on our Firebase Hosting domain. iOS opens it directly
      // in the app via universal links once the apple-app-site-
      // association file lives at https://<domain>/.well-known/.
      associatedDomains: ['applinks:balancesheet-android.web.app'],
    },
    android: {
      adaptiveIcon: {
        foregroundImage: './assets/adaptive-icon.png',
        // Navy matching the new logo's own background. The foreground
        // PNG already fills edge-to-edge, so this only shows if a
        // device mask crops past the foreground.
        backgroundColor: '#3F5691',
      },
      permissions: [
        'android.permission.CAMERA',
        'android.permission.READ_EXTERNAL_STORAGE',
        'android.permission.READ_MEDIA_IMAGES',
        'android.permission.USE_BIOMETRIC',
        'android.permission.USE_FINGERPRINT',
      ],
      package: 'com.kaushikmajumder.receiptscanner',
      versionCode: 2,
      googleServicesFile: process.env.GOOGLE_SERVICES_JSON ?? './google-services.json',
      // Phase 3 magic-link invites: paired with the iOS associated
      // domain above. autoVerify=true makes Android verify the
      // assetlinks.json file on the hosting domain at install time
      // and route matching URLs directly to the app.
      intentFilters: [
        {
          action: 'VIEW',
          autoVerify: true,
          data: [
            {
              scheme: 'https',
              host: 'balancesheet-android.web.app',
              pathPrefix: '/invite',
            },
            // Password-reset deep link (lib/auth.ts's sendPasswordReset)
            // — same App Link setup as /invite above.
            {
              scheme: 'https',
              host: 'balancesheet-android.web.app',
              pathPrefix: '/reset-password',
            },
          ],
          category: ['BROWSABLE', 'DEFAULT'],
        },
      ],
    },
    plugins: [
      'expo-router',
      'expo-secure-store',
      '@react-native-firebase/app',
      '@react-native-firebase/auth',
      ['expo-camera', { cameraPermission: 'Allow ReceiptScanner to access your camera.' }],
      ['expo-image-picker', { photosPermission: 'Allow ReceiptScanner to access your photos.' }],
      '@react-native-community/datetimepicker',
      // Sets up the iOS aps-environment entitlement needed for remote
      // push (household activity alerts) — local-only notifications
      // worked without this, but real push via Expo's push service
      // needs it. Also needs `eas credentials` run once to upload an
      // APNs key from the Apple Developer account for iOS builds.
      'expo-notifications',
      [
        'expo-build-properties',
        {
          ios: { useFrameworks: 'static' },
          android: {
            // Google Play minimum target raised to API 35 (Android 15)
            // for new app uploads in 2026. compileSdk must be >=
            // targetSdk so both bump together. buildTools 35.0.0
            // matches the SDK version.
            compileSdkVersion: 35,
            targetSdkVersion: 35,
            buildToolsVersion: '35.0.0',
            // Expo SDK 52 ships Kotlin 1.9.24 but bundles a Compose
            // Compiler (1.5.15) that requires 1.9.25 — the build
            // fails with a "not known to be compatible" error
            // unless we bump Kotlin explicitly. 1.9.25 is the
            // minimum that satisfies both.
            kotlinVersion: '1.9.25',
          },
        },
      ],
    ],
    experiments: { typedRoutes: true },
    scheme: 'receipt-scanner',
    extra: {
      eas: { projectId: 'bbdefab5-4cc5-4480-96a9-8ece7eb913a5' },
      googleWebClientId:
        process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID ??
        '858326644205-etreldr96iispa3mr6cv6vcfv1ivukf1.apps.googleusercontent.com',
      // Gemini API key for AI-powered classification — sourced from the
      // EAS sensitive env var GEMINI_API_KEY at build/update time so the
      // raw value never lives in this repo. Restricted server-side to
      // this app's package + SHA-1 so an extracted key can't be abused
      // outside the app.
      geminiApiKey: process.env.GEMINI_API_KEY,
      // Optional: a Cloudflare Worker that wraps Workers AI as a free
      // fallback when the shared Gemini quota is exhausted. Set
      // PARSE_ENDPOINT to e.g. https://...workers.dev/parse and
      // PARSE_ENDPOINT_SECRET to the same secret the worker validates.
      // See scripts/parse-receipt-worker.ts for the deploy guide.
      parseEndpoint: process.env.PARSE_ENDPOINT,
      parseEndpointSecret: process.env.PARSE_ENDPOINT_SECRET,
      // EmailJS credentials for sending household-invite emails from
      // a connected Gmail account. All three are public by design —
      // EmailJS uses domain/rate-limit allow-listing for protection,
      // not key secrecy. Set via EAS env vars at build/update time.
      emailjsServiceId: process.env.EMAILJS_SERVICE_ID,
      emailjsTemplateId: process.env.EMAILJS_TEMPLATE_ID,
      emailjsPublicKey: process.env.EMAILJS_PUBLIC_KEY,
      // Cloudflare Worker that sends SMS phone invites via Twilio (the
      // Twilio secret itself lives only in that worker, never here).
      // See scripts/sms-invite-worker.ts for the deploy guide. Absent
      // means "not configured yet" — lib/phoneInvite.ts falls back to
      // in-app-only invites (still visible to the invitee once they
      // sign up and verify that phone number) when this is unset.
      smsWorkerEndpoint: process.env.SMS_WORKER_ENDPOINT,
      smsWorkerSecret: process.env.SMS_WORKER_SECRET,
    },
  });
};
