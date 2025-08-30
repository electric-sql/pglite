import Foundation

@_cdecl("PGLiteCopyRuntimeToDir")
func PGLiteCopyRuntimeToDir(_ destDirC: UnsafePointer<CChar>?) {
    autoreleasepool {
        NSLog("[RuntimeCopy] PGLiteCopyRuntimeToDir called")
        
        guard let destDirC = destDirC,
              let destDirString = String(validatingUTF8: destDirC),
              !destDirString.isEmpty else {
            NSLog("[RuntimeCopy] ERROR: Invalid destination directory")
            return
        }
        
        let destDir = destDirString
        NSLog("[RuntimeCopy] Destination directory: %@", destDir)
        
        let fm = FileManager.default
        
        var isDir: ObjCBool = false
        if !fm.fileExists(atPath: destDir, isDirectory: &isDir) || !isDir.boolValue {
            NSLog("[RuntimeCopy] Creating destination directory: %@", destDir)
            try? fm.createDirectory(atPath: destDir, withIntermediateDirectories: true, attributes: nil)
        }
        
        // Try different resource paths based on new podspec structure
        var runtimeRoot: String? = nil
        
        // First try: RuntimeResources/PGLiteRuntime in main bundle
        if let resourcesPath = Bundle.main.path(forResource: "RuntimeResources", ofType: nil) {
            let runtimePath = (resourcesPath as NSString).appendingPathComponent("PGLiteRuntime")
            if fm.fileExists(atPath: runtimePath) {
                runtimeRoot = runtimePath
                NSLog("[RuntimeCopy] Found runtime at: %@", runtimePath)
            } else {
                NSLog("[RuntimeCopy] RuntimeResources found but no PGLiteRuntime subdirectory")
            }
        } else {
            NSLog("[RuntimeCopy] RuntimeResources not found in main bundle")
        }
        
        // Second try: Direct PGLiteRuntime (legacy)
        if runtimeRoot == nil {
            if let directPath = Bundle.main.path(forResource: "PGLiteRuntime", ofType: nil) {
                runtimeRoot = directPath
                NSLog("[RuntimeCopy] Found runtime at legacy path: %@", directPath)
            } else {
                NSLog("[RuntimeCopy] PGLiteRuntime not found in main bundle")
            }
        }
        
        // Third try: Check current bundle (for pods)
        if runtimeRoot == nil {
            guard let bundle = Bundle(for: NSObject.self) as Bundle? else {
                NSLog("[RuntimeCopy] ERROR: Could not get current bundle")
                return
            }
            
            if let bundlePath = bundle.path(forResource: "RuntimeResources/PGLiteRuntime", ofType: nil) {
                runtimeRoot = bundlePath
                NSLog("[RuntimeCopy] Found runtime in current bundle: %@", bundlePath)
            } else if let legacyPath = bundle.path(forResource: "PGLiteRuntime", ofType: nil) {
                runtimeRoot = legacyPath
                NSLog("[RuntimeCopy] Found runtime at legacy pod path: %@", legacyPath)
            } else {
                NSLog("[RuntimeCopy] Runtime not found in current bundle")
            }
        }
        
        guard let finalRuntimeRoot = runtimeRoot else {
            NSLog("[RuntimeCopy] ERROR: Could not locate PGLite runtime resources")
            return
        }
        
        NSLog("[RuntimeCopy] Copying runtime from: %@ to: %@", finalRuntimeRoot, destDir)
        copyRuntime(from: finalRuntimeRoot, to: destDir)
    }
}

private func copyRuntime(from runtimeRoot: String, to destDir: String) {
    NSLog("[RuntimeCopy] copyRuntime called with source: %@ dest: %@", runtimeRoot, destDir)
    
    let fm = FileManager.default
    let shareSrc = (runtimeRoot as NSString).appendingPathComponent("share")
    
    NSLog("[RuntimeCopy] Looking for share directory at: %@", shareSrc)
    
    var shareIsDir: ObjCBool = false
    guard fm.fileExists(atPath: shareSrc, isDirectory: &shareIsDir) && shareIsDir.boolValue else {
        NSLog("[RuntimeCopy] ERROR: share directory not found at %@", shareSrc)
        return
    }
    
    NSLog("[RuntimeCopy] Found share directory, setting up destination")
    
    let shareDst = (destDir as NSString).appendingPathComponent("share")
    
    NSLog("[RuntimeCopy] Creating destination directory: %@", shareDst)
    try? fm.createDirectory(atPath: shareDst, withIntermediateDirectories: true, attributes: nil)
    
    guard let enumerator = fm.enumerator(atPath: shareSrc) else { 
        NSLog("[RuntimeCopy] ERROR: Could not create enumerator for source path")
        return 
    }
    
    var fileCount = 0
    var dirCount = 0
    
    while let relPath = enumerator.nextObject() as? String {
        let srcPath = (shareSrc as NSString).appendingPathComponent(relPath)
        let dstPath = (shareDst as NSString).appendingPathComponent(relPath)
        
        var isDir: ObjCBool = false
        fm.fileExists(atPath: srcPath, isDirectory: &isDir)
        
        if isDir.boolValue {
            try? fm.createDirectory(atPath: dstPath, withIntermediateDirectories: true, attributes: nil)
            dirCount += 1
        } else {
            if !fm.fileExists(atPath: dstPath) {
                do {
                    try fm.copyItem(atPath: srcPath, toPath: dstPath)
                    fileCount += 1
                } catch {
                    NSLog("[RuntimeCopy] ERROR: Failed to copy %@ to %@: %@", srcPath, dstPath, error.localizedDescription)
                }
            }
        }
    }
    
    NSLog("[RuntimeCopy] Copy completed: %d files, %d directories (copied entire share/ directory structure)", fileCount, dirCount)
}