import Foundation
import ExpoModulesCore

@objc(PGLiteAppDelegateSubscriber)
public class PGLiteAppDelegateSubscriber: ExpoAppDelegateSubscriber {
  public func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey : Any]? = nil) -> Bool {
    PGLiteEnv.applyRuntimeEnv()
    return true
  }
}

