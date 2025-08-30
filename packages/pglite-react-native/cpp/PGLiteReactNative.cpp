#include "PGLiteReactNative.hpp"
#include <sys/stat.h>
#include <sys/types.h>

#include <cstring>
#include <cstdlib>
#include <filesystem>
#include <fstream>
#include "RuntimeResources.hpp"
#ifdef __ANDROID__
#include <android/log.h>
#ifndef ANDROID_LOG_WARN
#define ANDROID_LOG_WARN ANDROID_LOG_DEBUG
#endif
#define PGLOG(level, ...) __android_log_print(level, "PGLiteReactNative", __VA_ARGS__)
#define PGLOG_INFO(...) __android_log_print(ANDROID_LOG_INFO, "PGLiteReactNative", __VA_ARGS__)
#define PGLOG_ERROR(...) __android_log_print(ANDROID_LOG_ERROR, "PGLiteReactNative", __VA_ARGS__)
#define PGLOG_WARN(...) __android_log_print(ANDROID_LOG_WARN, "PGLiteReactNative", __VA_ARGS__)
#elif __APPLE__
#include <iostream>
#define PGLOG(level, ...) do { \
  fprintf(stderr, "[PGLiteReactNative] "); \
  fprintf(stderr, __VA_ARGS__); \
  fprintf(stderr, "\n"); \
  fflush(stderr); \
} while(0)
#define PGLOG_INFO(...) PGLOG(0, __VA_ARGS__)
#define PGLOG_ERROR(...) PGLOG(0, __VA_ARGS__)
#define PGLOG_WARN(...) PGLOG(0, __VA_ARGS__)
#else
#include <iostream>
#define PGLOG(level, ...) do { \
  fprintf(stderr, "[PGLiteReactNative] "); \
  fprintf(stderr, __VA_ARGS__); \
  fprintf(stderr, "\n"); \
  fflush(stderr); \
} while(0)
#define PGLOG_INFO(...) PGLOG(0, __VA_ARGS__)
#define PGLOG_ERROR(...) PGLOG(0, __VA_ARGS__)
#define PGLOG_WARN(...) PGLOG(0, __VA_ARGS__)
#endif



extern "C" {
  int pgl_initdb();
  void pgl_backend();
  void pgl_shutdown();
  int interactive_read();
  void interactive_write(int size);
  void interactive_one();
  void use_wire(int state);
  intptr_t get_buffer_addr(int fd);
  int get_buffer_size(int fd);
}

namespace fs = std::filesystem;

namespace margelo { namespace nitro { namespace electricsql { namespace pglite {

static std::once_flag s_start_once;
static std::atomic<bool> s_started{false};

static std::string defaultPgdata() {
  // Keep in sync with wasm_common.h default; can be made configurable later.
  return std::string("/tmp/pglite/base");
}

static std::string getEnvOr(const char* key, const std::string& fallback) {
  const char* v = std::getenv(key);
  return v ? std::string(v) : fallback;
}

static void ensureDir(const std::string& path) {
  std::error_code ec;
  fs::create_directories(path, ec);
}

PGLiteRNNative::PGLiteRNNative() {}
PGLiteRNNative::~PGLiteRNNative() {}

void PGLiteRNNative::ensureStarted_() {
  if (!s_started.load(std::memory_order_acquire)) {
    std::call_once(s_start_once, [this]() {
    // Establish runtime paths and env vars; ensure directories exist.
    auto paths = RuntimeResources::prepare();
    // Defaults to a valid single-user combo
    if (!std::getenv("PGUSER")) ::setenv("PGUSER", "postgres", 1);
    if (!std::getenv("PGDATABASE")) ::setenv("PGDATABASE", "template1", 1);

    // Derive PREFIX from PGDATA (parent directory of the base dir) to mirror WASM
    const char* pgdataEnv = std::getenv("PGDATA");
    std::string pgdata = pgdataEnv ? std::string(pgdataEnv) : defaultPgdata();
    // Common default uses "/.../base"; compute parent. Fallback to dirname.
    std::string prefix;
    if (pgdata.size() >= 5 && pgdata.rfind("/base") == pgdata.size() - 5) {
      prefix = pgdata.substr(0, pgdata.size() - 5);
    } else {
      prefix = fs::path(pgdata).parent_path().string();
      if (prefix.empty()) prefix = "/tmp/pglite"; // last resort
    }

    // Ensure directories exist (PREFIX and PGDATA)
    ensureDir(prefix);
    ensureDir(pgdata);

    // Ensure required runtime catalog files exist like wasm (share/postgresql/*)
    // We ship these in the module; app should extract them to paths.runtimeDir.
    const std::string shareDir = paths.runtimeDir + "/share/postgresql";
    const std::string altShareDir = paths.runtimeDir + "/postgresql"; // fallback if assets root already points at share
    const std::string bkiFile = shareDir + "/postgres.bki";
    const std::string bkiAlt = altShareDir + "/postgres.bki";
    bool haveShare = fs::exists(shareDir) && fs::exists(bkiFile);
    bool haveAlt = fs::exists(altShareDir) && fs::exists(bkiAlt);
    const std::string chosenShare = haveShare ? shareDir : (haveAlt ? altShareDir : shareDir);
    if (!haveShare && !haveAlt) {
      PGLOG_ERROR("Missing runtime catalogs at %s (or %s). Ensure assets packaged and copied.",
        shareDir.c_str(), altShareDir.c_str());
      throw std::runtime_error(std::string("PGLite runtime catalogs missing: ") + shareDir);
    }

    // PGSYSCONFDIR should point to parent of 'share' directory so PostgreSQL can find:
    // - share/postgresql/postgres.bki (for initdb)  
    // - share/timezonesets/* (for timezone abbreviations) 
    // - share/timezone/* (for timezone data)
    // After PGLiteCopyRuntimeToDir copies the bundle, runtimeDir contains the share/ structure
    ::setenv("PGSYSCONFDIR", paths.runtimeDir.c_str(), 1);

    // Ensure PREFIX points at runtime root like WASM_PREFIX (so initdb argv uses PREFIX/password)
    ::setenv("PREFIX", paths.runtimeDir.c_str(), 1);

    // Ensure PGROOT and password file exist (WASM passes --pwfile=${PREFIX}/password)
    const std::string pgroot = paths.runtimeDir; // mirror wasm
    ::setenv("PGROOT", pgroot.c_str(), 1);

    // Create password in both PREFIX and PGROOT locations to be safe
    const std::string prefixEnv = getEnvOr("PREFIX", paths.runtimeDir);
    const std::string pw_prefix = prefixEnv + "/password";
    const std::string pw_pgroot = pgroot + "/password";
    auto writeIfMissing = [](const std::string& p) {
      if (!fs::exists(p)) { std::ofstream out(p, std::ios::out | std::ios::trunc); out << "password"; out.close(); }
    };
    writeIfMissing(pw_prefix);
    if (pw_pgroot != pw_prefix) writeIfMissing(pw_pgroot);

    // Extra diagnostics: log env and chosen share path
#ifdef __ANDROID__
    const char* env_runtime = getenv("ANDROID_RUNTIME_DIR");
#elif __APPLE__
    const char* env_runtime = getenv("IOS_RUNTIME_DIR");
#else
    const char* env_runtime = nullptr;
#endif
    const char* env_pgdata = getenv("PGDATA");
    const char* env_prefix = getenv("PREFIX");
    const char* env_conf = getenv("PGSYSCONFDIR");
    const char* env_pgroot = getenv("PGROOT");
    PGLOG_INFO("initdb about to run. runtime=%s pgdata=%s prefix=%s confdir=%s chosenShare=%s pgroot=%s",
      env_runtime ? env_runtime : "", env_pgdata ? env_pgdata : "", env_prefix ? env_prefix : "", env_conf ? env_conf : "", chosenShare.c_str(), env_pgroot ? env_pgroot : "");

    // Set up logging - redirect to file on Android, keep console output on iOS for Xcode debugging
    const std::string errLog = paths.runtimeDir + "/initdb.stderr.log";
    ::setenv("PGL_INITDB_LOG", errLog.c_str(), 1);
    
    // Declare variables for both platforms, but only use them on Android
    FILE* __pgl_stderr = nullptr;
    FILE* __pgl_stdout = nullptr;
    
#ifdef __ANDROID__
    // Android: Redirect stderr and stdout to a file so we can read all initdb output
    // Use append mode and unbuffered streams to avoid truncation and lost logs on crashes
    __pgl_stderr = freopen(errLog.c_str(), "a", stderr);
    if (__pgl_stderr) setvbuf(stderr, NULL, _IONBF, 0);
    __pgl_stdout = freopen(errLog.c_str(), "a", stdout);
    if (__pgl_stdout) setvbuf(stdout, NULL, _IONBF, 0);
    PGLOG_INFO("initdb logs redirected (append, unbuffered) to %s (pwfile=%s)", errLog.c_str(), pw_prefix.c_str());
#else
    // iOS: Keep stderr/stdout for Xcode console, but also write to file for debugging
    // Create the log file but don't redirect stderr/stdout
    FILE* logFile = fopen(errLog.c_str(), "a");
    if (logFile) {
        fclose(logFile);
    }
    PGLOG_INFO("iOS: initdb logs will appear in Xcode console and be logged to %s (pwfile=%s)", errLog.c_str(), pw_prefix.c_str());
#endif

    // Call raw initdb so we see real error traces (may abort on failure)
    PGLOG_INFO("Calling pgl_initdb()...");
    int initdb_rc = pgl_initdb();
    PGLOG_INFO("*** pgl_initdb() returned %d ***", initdb_rc);
    fprintf(stderr, "*** REACT NATIVE: Successfully returned from pgl_initdb() ***\n");
    fprintf(stderr, "*** REACT NATIVE: About to continue execution ***\n");
    PGLOG_INFO("*** REACT NATIVE: Successfully returned from pgl_initdb() ***");

    // Force flush any pending logs
    fflush(stdout);
    fflush(stderr);

    // If we got here, initdb completed
#ifdef __ANDROID__
    // Android: stderr was redirected, keep it redirected for subsequent backend logs
    if (__pgl_stderr) {
      fflush(stderr);
      // Do not fclose(stderr) here; leave it redirected for subsequent backend logs
    }
    PGLOG_INFO("initdb completed successfully (Android - logs in file)");
#else
    // iOS: stderr was not redirected, it's already going to Xcode console
    PGLOG_INFO("initdb completed successfully (iOS - logs in Xcode console)");
#endif

    PGLOG_ERROR("DEBUG: About to log 'About to call pgl_backend()'");
    PGLOG_INFO("About to call pgl_backend()...");
    pgl_backend();
    PGLOG_INFO("pgl_backend() returned successfully");
    
    // Try to read and log the stderr log file to see what happened
    std::ifstream logFileStream(errLog);
    if (logFileStream.is_open()) {
        std::string line;
        int lineCount = 0;
        PGLOG_INFO("=== Contents of %s ===", errLog.c_str());
        while (std::getline(logFileStream, line) && lineCount < 100) {  // Limit to first 100 lines
            PGLOG_INFO("[stderr] %s", line.c_str());
            lineCount++;
        }
        logFileStream.close();
        PGLOG_INFO("=== End of stderr log (showed %d lines) ===", lineCount);
    } else {
        PGLOG_WARN("Could not open stderr log file: %s", errLog.c_str());
    }
    
    s_started.store(true, std::memory_order_release);
    started_ = true;
  });
  } else {
    started_ = true;
  }
}

std::vector<uint8_t> PGLiteRNNative::execProtocolRaw(
  const std::vector<uint8_t>& message,
  const ExecProtocolOptionsNative& opts) {
  std::lock_guard<std::mutex> lock(mtx_);
  ensureStarted_();
  // Prefer CMA/wire fast path when possible (avoids socketfile mode on mobile)
  return execProtocolRaw(message.data(), message.size(), opts);
}


std::vector<uint8_t> PGLiteRNNative::execProtocolRaw(
  const uint8_t* data,
  size_t size,
  const ExecProtocolOptionsNative& /*opts*/) {
  PGLOG_INFO("execProtocolRaw (CMA-only) called with size=%zu", size);
  std::lock_guard<std::mutex> lock(mtx_);
  ensureStarted_();

  // CMA request path
  const int inCap = get_buffer_size(0);
  if (static_cast<int>(size) >= inCap) {
    PGLOG_ERROR("CMA request too large: size=%zu cap=%d (no file-mode fallback)", size, inCap);
    return {};
  }
  // get_buffer_addr(0) returns (buf + 1) to match WASM semantics; write at +1
  uint8_t* buf_base = reinterpret_cast<uint8_t*>(static_cast<intptr_t>(get_buffer_addr(0))) - 1;
  memcpy(buf_base + 1, data, size);
  use_wire(1);
  interactive_write(static_cast<int>(size));
  interactive_one();

  // CMA response path
  const int outCap = get_buffer_size(1);
  const int outLen = interactive_read();
  std::vector<uint8_t> out;
  if (outLen > 0 && outLen <= outCap) {
    const size_t start = static_cast<size_t>(size) + 2;
    const uint8_t* outBase = reinterpret_cast<uint8_t*>(static_cast<intptr_t>(get_buffer_addr(1)));
    if (start + static_cast<size_t>(outLen) <= static_cast<size_t>(outCap)) {
      out.assign(outBase + start, outBase + start + outLen);
    } else {
      PGLOG_WARN("CMA reply slice oob: start=%zu len=%d cap=%d", start, outLen, outCap);
    }
  } else {
    PGLOG_WARN("CMA reply empty or too large: outLen=%d outCap=%d", outLen, outCap);
  }
  return out;
}


void PGLiteRNNative::close() {
  std::lock_guard<std::mutex> lock(mtx_);
  if (started_) {
    pgl_shutdown();
    started_ = false;
  }
}

// Nitro hybrid object implementations
std::shared_ptr<Promise<std::shared_ptr<ArrayBuffer>>> PGLiteReactNative::execProtocolRaw(
    const std::shared_ptr<ArrayBuffer>& message,
    const std::optional<ExecProtocolOptionsNative>& options) {
  // Copy message bytes on the JS thread before going async (Nitro requires this)
  std::vector<uint8_t> input;
  if (message) {
    const uint8_t* jsData = message->data();
    const size_t jsSize = message->size();
    input.assign(jsData, jsData + jsSize);
  }

  ExecProtocolOptionsNative nativeOpts{};
  if (options.has_value()) {
    nativeOpts = *options;
  }

  return Promise<std::shared_ptr<ArrayBuffer>>::async([this, input = std::move(input), nativeOpts]() mutable {
    // Execute through existing native implementation (pointer/size)
    auto result = native_.execProtocolRaw(input.data(), input.size(), nativeOpts);
    // Return as ArrayBuffer (copy)
    return ArrayBuffer::copy(result);
  });
}

std::shared_ptr<Promise<void>> PGLiteReactNative::close() {
  return Promise<void>::async([this]() {
    native_.close();
  });
}

}}}} // namespace margelo::nitro::electricsql::pglite

