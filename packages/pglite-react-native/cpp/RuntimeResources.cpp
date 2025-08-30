#include "RuntimeResources.hpp"
#include <filesystem>
#include <cstdlib>

namespace fs = std::filesystem;

namespace margelo { namespace nitro { namespace electricsql { namespace pglite {

static std::string defaultDataDir() {
#ifdef __ANDROID__
  const char* base = std::getenv("ANDROID_DATA_DIR"); // optional override from Kotlin
  if (base) return std::string(base) + "/pglite/pgdata";
  return std::string("/data/local/tmp/pglite/pgdata");
#elif __APPLE__
  const char* base = std::getenv("IOS_APP_SUPPORT"); // optional override from Swift
  if (base) return std::string(base) + "/PGLite/pgdata";
  return std::string("/tmp/pglite/base");
#else
  return std::string("/tmp/pglite/base");
#endif
}

RuntimePaths RuntimeResources::prepare() {
#ifdef __APPLE__
  // Set up iOS environment variables before reading them
  PGLiteSetupIOSEnvironment();
#endif

  RuntimePaths paths;
  const char* pgdataEnv = std::getenv("PGDATA");
  paths.pgdata = pgdataEnv ? std::string(pgdataEnv) : defaultDataDir();

#ifdef __APPLE__
  printf("[RuntimeResources] iOS environment - PGDATA: %s\n", paths.pgdata.c_str());
  const char* iosAppSupport = std::getenv("IOS_APP_SUPPORT");
  const char* iosRuntimeDir = std::getenv("IOS_RUNTIME_DIR");
  printf("[RuntimeResources] IOS_APP_SUPPORT: %s\n", iosAppSupport ? iosAppSupport : "not set");
  printf("[RuntimeResources] IOS_RUNTIME_DIR: %s\n", iosRuntimeDir ? iosRuntimeDir : "not set");
#endif

  // runtimeDir holds share/postgresql; default to pgdata and overwrite on extraction
  paths.runtimeDir = paths.pgdata;

  std::error_code ec;
  fs::create_directories(paths.pgdata, ec);
  fs::create_directories(paths.runtimeDir, ec);

#ifdef __ANDROID__
  // Android: copy runtime from assets/pglite/share/postgresql -> runtimeDir/share/postgresql
  // Actual asset extraction must be done from Kotlin. We provide an env hook.
  const char* androidRuntime = std::getenv("ANDROID_RUNTIME_DIR");
  if (androidRuntime) {
    paths.runtimeDir = androidRuntime;
    fs::create_directories(paths.runtimeDir, ec);
  }
#endif

#ifdef __APPLE__
  // iOS: copy runtime from app bundle via Objective-C++ helper
  // Expose IOS_APP_SUPPORT for override; default to tmp path above if not set
  const char* iosRuntime = std::getenv("IOS_RUNTIME_DIR");
  if (iosRuntime) {
    printf("[RuntimeResources] Using IOS_RUNTIME_DIR: %s\n", iosRuntime);
    paths.runtimeDir = iosRuntime;
  } else {
    printf("[RuntimeResources] IOS_RUNTIME_DIR not set, using default: %s\n", paths.runtimeDir.c_str());
  }
  
  printf("[RuntimeResources] Final runtimeDir: %s\n", paths.runtimeDir.c_str());
  fs::create_directories(paths.runtimeDir, ec);
  
  // Bridge to Swift helper to copy share/postgresql into runtimeDir
  printf("[RuntimeResources] Calling PGLiteCopyRuntimeToDir with: %s\n", paths.runtimeDir.c_str());
  PGLiteCopyRuntimeToDir(paths.runtimeDir.c_str());
  printf("[RuntimeResources] PGLiteCopyRuntimeToDir completed\n");
#endif

  // Export env vars for backend init
  printf("[RuntimeResources] Setting PGDATA=%s\n", paths.pgdata.c_str());
  printf("[RuntimeResources] Setting PGSYSCONFDIR=%s\n", paths.runtimeDir.c_str());
  ::setenv("PGDATA", paths.pgdata.c_str(), 1);
  ::setenv("PGSYSCONFDIR", paths.runtimeDir.c_str(), 1);
  // Do not set skip flags by default; align with WASM behavior. Only set them
  // when we explicitly load a prebuilt snapshot (done in native startup code).
  printf("[RuntimeResources] RuntimeResources::prepare() completed successfully\n");
  return paths;
}

}}}} // namespace margelo::nitro::electricsql::pglite

