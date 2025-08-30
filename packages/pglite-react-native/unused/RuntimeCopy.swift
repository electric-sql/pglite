import Foundation

func PGLiteCopyRuntimeToDir(_ destDirC: UnsafePointer<CChar>?) {
    autoreleasepool {
        guard let destDirC = destDirC,
              let destDirString = String(validatingUTF8: destDirC),
              !destDirString.isEmpty else {
            return
        }
        
        let destDir = destDirString
        let fm = FileManager.default
        
        var isDir: ObjCBool = false
        if !fm.fileExists(atPath: destDir, isDirectory: &isDir) || !isDir.boolValue {
            try? fm.createDirectory(atPath: destDir, withIntermediateDirectories: true, attributes: nil)
        }
        
        guard let bundle = Bundle(for: NSObject.self) as Bundle?,
              let runtimeRoot = bundle.path(forResource: "PGLiteRuntime", ofType: nil) else {
            if let mainBundle = Bundle.main.path(forResource: "PGLiteRuntime", ofType: nil) {
                copyRuntime(from: mainBundle, to: destDir)
            }
            return
        }
        
        copyRuntime(from: runtimeRoot, to: destDir)
    }
}

private func copyRuntime(from runtimeRoot: String, to destDir: String) {
    let fm = FileManager.default
    let shareSrc = (runtimeRoot as NSString).appendingPathComponent("share/postgresql")
    
    var shareIsDir: ObjCBool = false
    guard fm.fileExists(atPath: shareSrc, isDirectory: &shareIsDir) && shareIsDir.boolValue else {
        return
    }
    
    let shareDstRoot = (destDir as NSString).appendingPathComponent("share")
    let shareDst = (shareDstRoot as NSString).appendingPathComponent("postgresql")
    
    try? fm.createDirectory(atPath: shareDst, withIntermediateDirectories: true, attributes: nil)
    
    guard let enumerator = fm.enumerator(atPath: shareSrc) else { return }
    
    while let relPath = enumerator.nextObject() as? String {
        let srcPath = (shareSrc as NSString).appendingPathComponent(relPath)
        let dstPath = (shareDst as NSString).appendingPathComponent(relPath)
        
        var isDir: ObjCBool = false
        fm.fileExists(atPath: srcPath, isDirectory: &isDir)
        
        if isDir.boolValue {
            try? fm.createDirectory(atPath: dstPath, withIntermediateDirectories: true, attributes: nil)
        } else {
            if !fm.fileExists(atPath: dstPath) {
                try? fm.copyItem(atPath: srcPath, toPath: dstPath)
            }
        }
    }
}