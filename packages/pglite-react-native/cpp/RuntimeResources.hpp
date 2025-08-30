#pragma once
#include <string>

namespace margelo { namespace nitro { namespace electricsql { namespace pglite {

struct RuntimePaths {
  std::string pgdata;
  std::string runtimeDir; // where share/postgresql lives
};

class RuntimeResources {
public:
  // Resolve platform paths and ensure dirs; call before initdb.
  static RuntimePaths prepare();
};


// Minimal untar interface (implemented in PGLiteReactNative.cpp for now)
namespace margelo { namespace nitro { namespace electricsql { namespace pglite {
  bool untarFile(const char* tarPath, const char* dstDir, char* errBuf, size_t errLen);
}}}}

}}}} // namespace margelo::nitro::electricsql::pglite

// iOS-only helpers implemented in Swift
#ifdef __APPLE__
extern "C" void PGLiteCopyRuntimeToDir(const char* destDir);
extern "C" void PGLiteSetupIOSEnvironment(void);
#endif

