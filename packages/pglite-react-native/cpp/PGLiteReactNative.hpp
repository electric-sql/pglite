#pragma once
#include <vector>
#include <memory>
#include <mutex>
#include <string>

namespace electricsql { namespace pglite {

struct ExecProtocolOptionsNative {
  bool syncToFs{true};
};

class PGLiteRNNative final {
public:
  PGLiteRNNative();
  ~PGLiteRNNative();

  // Vector-based API (legacy)
  std::vector<uint8_t> execProtocolRaw(const std::vector<uint8_t>& message,
                                       const ExecProtocolOptionsNative& opts);
  // Zero-copy-friendly API: pass raw pointer and size for input
  std::vector<uint8_t> execProtocolRaw(const uint8_t* data,
                                       size_t size,
                                       const ExecProtocolOptionsNative& opts);
  void close();

  // TODO: init: ensure dirs, env, call pgl_initdb and pgl_backend once

private:
  std::mutex mtx_;
  bool started_{false};
  // Helper functions for file-mode fallback
  std::vector<uint8_t> fileModeExec_(const std::vector<uint8_t>& message);
  std::vector<uint8_t> fileModeExecPtr_(const uint8_t* data, size_t size);
  void ensureStarted_();
};

}} // namespace electricsql::pglite

