import Foundation

public class PGLiteEnv {
  public static func applyRuntimeEnv() {
    NSLog("[PGLiteEnv] Setting up iOS environment paths")
    
    // Resolve Application Support path for runtime
    let fm = FileManager.default
    let appSupport = try? fm.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
    let runtime = appSupport?.appendingPathComponent("PGLite/runtime", isDirectory: true)
    let pgdata = appSupport?.appendingPathComponent("PGLite/pgdata", isDirectory: true)

    if let runtime = runtime {
      NSLog("[PGLiteEnv] Creating runtime directory: %@", runtime.path)
      try? fm.createDirectory(at: runtime, withIntermediateDirectories: true, attributes: nil)
      setenv("IOS_RUNTIME_DIR", (runtime.path as NSString).utf8String, 1)
    }
    
    if let appSupport = appSupport {
      NSLog("[PGLiteEnv] Setting IOS_APP_SUPPORT to: %@", appSupport.path)
      setenv("IOS_APP_SUPPORT", (appSupport.path as NSString).utf8String, 1)
    }
    
    if let pgdata = pgdata {
      NSLog("[PGLiteEnv] Creating pgdata directory: %@", pgdata.path)
      try? fm.createDirectory(at: pgdata, withIntermediateDirectories: true, attributes: nil)
      setenv("PGDATA", (pgdata.path as NSString).utf8String, 1)
    }
    
    NSLog("[PGLiteEnv] Environment setup completed")
  }
}

// C-callable wrapper for use from C++
@_cdecl("PGLiteSetupIOSEnvironment")
func PGLiteSetupIOSEnvironment() {
    PGLiteEnv.applyRuntimeEnv()
}

