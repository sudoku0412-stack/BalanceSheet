import Expo
import FirebaseCore
import React
import ReactAppDependencyProvider

// Migrated off the deprecated Objective-C EXAppDelegateWrapper (see its
// header: "EXAppDelegateWrapper is deprecated... use ExpoAppDelegate
// instead"). That deprecated wrapper's didFinishLaunchingWithOptions only
// forwards to Expo module subscribers — it never actually creates a
// UIWindow or starts the React Native factory. With no window ever
// created, the RN root view had nothing to render into: the app just sat
// on the native splash screen forever (Release) or, in dev-client Debug
// builds, crashed outright in ExpoDevLauncherAppDelegateSubscriber with
// "Cannot find the keyWindow" — same root cause, two symptoms. This
// class creates the window and starts the factory itself, matching
// Expo SDK 53's own current template, then hands off to super so Expo's
// module subscribers still run afterward (dev-launcher included) with a
// real window already in place.
@objc(AppDelegate)
public class AppDelegate: ExpoAppDelegate {
  var window: UIWindow?
  var moduleName = "main"

  var reactNativeDelegate: ReactNativeDelegate?
  var reactNativeFactory: RCTReactNativeFactory?

  public override func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    FirebaseApp.configure()

    // Unused beyond this line — kept only because @react-native-firebase/
    // app's config plugin (modifySwiftAppDelegate) anchors its
    // FirebaseApp.configure() insertion on a `self.moduleName = "..."`
    // match. Without it, a future `expo prebuild --clean` regenerating
    // this file wouldn't find where to re-insert Firebase config.
    self.moduleName = "main"

    let delegate = ReactNativeDelegate()
    let factory = ExpoReactNativeFactory(delegate: delegate)
    delegate.dependencyProvider = RCTAppDependencyProvider()

    reactNativeDelegate = delegate
    reactNativeFactory = factory
    bindReactNativeFactory(factory)

    window = UIWindow(frame: UIScreen.main.bounds)
    factory.startReactNative(
      withModuleName: moduleName,
      in: window,
      initialProperties: [:],
      launchOptions: launchOptions
    )

    return super.application(application, didFinishLaunchingWithOptions: launchOptions)
  }

  // Universal Links
  public override func application(
    _ application: UIApplication,
    continue userActivity: NSUserActivity,
    restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void
  ) -> Bool {
    let result = RCTLinkingManager.application(application, continue: userActivity, restorationHandler: restorationHandler)
    return super.application(application, continue: userActivity, restorationHandler: restorationHandler) || result
  }

  // Linking API — Firebase Auth invocations are handled elsewhere and
  // should not be forwarded to Expo Router.
  public override func application(
    _ app: UIApplication,
    open url: URL,
    options: [UIApplication.OpenURLOptionsKey: Any] = [:]
  ) -> Bool {
    if url.host?.caseInsensitiveCompare("firebaseauth") == .orderedSame {
      return false
    }
    return super.application(app, open: url, options: options) || RCTLinkingManager.application(app, open: url, options: options)
  }

  // Explicitly defined remote notification delegates to ensure
  // compatibility with some third-party libraries.
  public override func application(
    _ application: UIApplication,
    didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data
  ) {
    super.application(application, didRegisterForRemoteNotificationsWithDeviceToken: deviceToken)
  }

  public override func application(
    _ application: UIApplication,
    didFailToRegisterForRemoteNotificationsWithError error: Error
  ) {
    super.application(application, didFailToRegisterForRemoteNotificationsWithError: error)
  }

  public override func application(
    _ application: UIApplication,
    didReceiveRemoteNotification userInfo: [AnyHashable: Any],
    fetchCompletionHandler completionHandler: @escaping (UIBackgroundFetchResult) -> Void
  ) {
    super.application(application, didReceiveRemoteNotification: userInfo, fetchCompletionHandler: completionHandler)
  }
}

class ReactNativeDelegate: ExpoReactNativeFactoryDelegate {
  // Old architecture (Podfile.properties.json's newArchEnabled is
  // false) still routes through RCTBridge, which requires this —
  // ExpoReactNativeFactory only wires up bundleURL() by default since
  // it assumes New Architecture. Without this override the bridge
  // throws "Subclasses must implement a valid sourceURLForBridge
  // method" on launch.
  override func sourceURL(for bridge: RCTBridge) -> URL? {
    self.bundleURL()
  }

  override func bundleURL() -> URL? {
#if DEBUG
    return RCTBundleURLProvider.sharedSettings().jsBundleURL(forBundleRoot: ".expo/.virtual-metro-entry")
#else
    return Bundle.main.url(forResource: "main", withExtension: "jsbundle")
#endif
  }
}
