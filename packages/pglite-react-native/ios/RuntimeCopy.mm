#import <Foundation/Foundation.h>

// Copy bundled PGLite runtime (share/postgresql) into destination directory.
extern "C" void PGLiteCopyRuntimeToDir(const char* destDirC) {
  @autoreleasepool {
    NSString* destDir = [NSString stringWithUTF8String:destDirC ?: ""];
    if (destDir.length == 0) return;

    NSFileManager* fm = [NSFileManager defaultManager];
    BOOL isDir = NO;
    if (![fm fileExistsAtPath:destDir isDirectory:&isDir] || !isDir) {
      [fm createDirectoryAtPath:destDir withIntermediateDirectories:YES attributes:nil error:nil];
    }

    // Locate resource folder in the RN Pod's bundle
    // Expected structure inside bundle: PGLiteRuntime/share/postgresql/***
    NSBundle* bundle = [NSBundle bundleForClass:[NSObject class]]; // current framework bundle
    NSString* runtimeRoot = [bundle pathForResource:@"PGLiteRuntime" ofType:nil];
    if (!runtimeRoot) {
      // Also try main bundle fallback
      runtimeRoot = [[NSBundle mainBundle] pathForResource:@"PGLiteRuntime" ofType:nil];
      if (!runtimeRoot) return; // nothing to copy
    }

    NSString* shareSrc = [runtimeRoot stringByAppendingPathComponent:@"share/postgresql"];
    BOOL shareIsDir = NO;
    if (![fm fileExistsAtPath:shareSrc isDirectory:&shareIsDir] || !shareIsDir) return;

    NSString* shareDstRoot = [destDir stringByAppendingPathComponent:@"share"];
    NSString* shareDst = [shareDstRoot stringByAppendingPathComponent:@"postgresql"];

    // Create directories
    [fm createDirectoryAtPath:shareDst withIntermediateDirectories:YES attributes:nil error:nil];

    // Recursively copy contents (skip if files already exist with same size)
    NSDirectoryEnumerator* enumerator = [fm enumeratorAtPath:shareSrc];
    NSString* relPath;
    while ((relPath = [enumerator nextObject])) {
      NSString* srcPath = [shareSrc stringByAppendingPathComponent:relPath];
      NSString* dstPath = [shareDst stringByAppendingPathComponent:relPath];
      BOOL isDir = NO;
      [fm fileExistsAtPath:srcPath isDirectory:&isDir];
      if (isDir) {
        [fm createDirectoryAtPath:dstPath withIntermediateDirectories:YES attributes:nil error:nil];
      } else {
        if (![fm fileExistsAtPath:dstPath]) {
          [fm copyItemAtPath:srcPath toPath:dstPath error:nil];
        }
      }
    }
  }
}

