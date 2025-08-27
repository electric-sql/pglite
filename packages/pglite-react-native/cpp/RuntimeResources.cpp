#include "RuntimeResources.hpp"
#include <filesystem>
#include <cstdlib>

namespace fs = std::filesystem;

namespace electricsql { namespace pglite {

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
  RuntimePaths paths;
  const char* pgdataEnv = std::getenv("PGDATA");
  paths.pgdata = pgdataEnv ? std::string(pgdataEnv) : defaultDataDir();

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
    paths.runtimeDir = iosRuntime;
  }
  fs::create_directories(paths.runtimeDir, ec);
  // Bridge to ObjC++ helper to copy share/postgresql into runtimeDir
  PGLiteCopyRuntimeToDir(paths.runtimeDir.c_str());
#endif

  // Export env vars for backend init
  ::setenv("PGDATA", paths.pgdata.c_str(), 1);
  ::setenv("PGSYSCONFDIR", paths.runtimeDir.c_str(), 1);
  // Do not set skip flags by default; align with WASM behavior. Only set them
  // when we explicitly load a prebuilt snapshot (done in native startup code).
  return paths;
}

}} // namespace electricsql::pglite

