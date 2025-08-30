
import ExpoModulesCore

public class PGLiteAppDelegateSubscriber: ExpoAppDelegateSubscriber {
    public func applicationDidBecomeActive(_ application: UIApplication) {
        PGLiteEnv.applyRuntimeEnv()
    }
}

