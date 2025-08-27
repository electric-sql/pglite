import Foundation
import NitroModules

@objc public class PGLiteEnv: NSObject {
  @objc public static func applyRuntimeEnv() {
    // Resolve Application Support path for runtime
    let fm = FileManager.default
    let appSupport = try? fm.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
    let runtime = appSupport?.appendingPathComponent("PGLite/runtime", isDirectory: true)
    let pgdata = appSupport?.appendingPathComponent("PGLite/pgdata", isDirectory: true)

    if let runtime = runtime {
      try? fm.createDirectory(at: runtime, withIntermediateDirectories: true, attributes: nil)
      setenv("IOS_RUNTIME_DIR", (runtime.path as NSString).utf8String, 1)
    }
    if let appSupport = appSupport {
      setenv("IOS_APP_SUPPORT", (appSupport.path as NSString).utf8String, 1)
    }
    if let pgdata = pgdata {
      try? fm.createDirectory(at: pgdata, withIntermediateDirectories: true, attributes: nil)
      setenv("PGDATA", (pgdata.path as NSString).utf8String, 1)
    }
  }
}

