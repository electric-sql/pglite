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

// If native mobile libs are not linked (default), provide stub implementations so the module compiles.
#if !defined(PGLITE_MOBILE_HAS_NATIVE) || PGLITE_MOBILE_HAS_NATIVE == 0
extern "C" {
  int pgl_initdb() { PGLOG_WARN("stub pgl_initdb()"); return 0; }
  void pgl_backend() { PGLOG_WARN("stub pgl_backend()"); }
  void pgl_shutdown() { PGLOG_WARN("stub pgl_shutdown()"); }
  int interactive_read() { PGLOG_WARN("stub interactive_read()"); return 0; }
  void interactive_write(int size) { PGLOG_WARN("stub interactive_write(%d)", size); }
  void interactive_one() { PGLOG_WARN("stub interactive_one()"); }
  void use_wire(int state) { PGLOG_WARN("stub use_wire(%d)", state); }
  intptr_t get_buffer_addr(int) { PGLOG_WARN("stub get_buffer_addr()"); return 0; }
  int get_buffer_size(int) { PGLOG_WARN("stub get_buffer_size()"); return 0; }
}
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

std::vector<uint8_t> PGLiteRNNative::fileModeExecPtr_(const uint8_t* data, size_t size) {
  PGLOG_ERROR("fileModeExecPtr_ called with size=%zu", size);
  const std::string base = getEnvOr("PGDATA", defaultPgdata());
  ensureDir(base);

  const std::string pg_lck_in = base + "/.s.PGSQL.5432.lock.in";  // client input lock
  const std::string pg_in     = base + "/.s.PGSQL.5432.in";       // server reads
  const std::string pg_out    = base + "/.s.PGSQL.5432.out";      // server writes

  {
    std::ofstream of(pg_lck_in, std::ios::binary | std::ios::trunc);
    if (size) of.write(reinterpret_cast<const char*>(data), static_cast<std::streamsize>(size));
    of.close();
  }
  std::error_code ec;
  fs::remove(pg_in, ec);



    // CMA fast path when message fits shared buffer
    const int cap = get_buffer_size(0);
    PGLOG_ERROR("CMA buffer check: size=%d cap=%d", (int)size, cap);
    if (static_cast<int>(size) < cap) {
      PGLOG_ERROR("Taking CMA fast path");
      // get_buffer_addr(0) returns (g_buf + 1) to match WASM semantics
      // But we need to write to the base buffer (g_buf) and let PostgreSQL read from (g_buf + 1)
      // This matches WASM where JS writes to HEAPU8[1] and PG reads from address 1
      uint8_t* buf_base = reinterpret_cast<uint8_t*>(static_cast<intptr_t>(get_buffer_addr(0))) - 1;
      PGLOG_INFO("CMA fast-path cap=%d size=%d base=%p", cap, (int)size, (void*)buf_base);

      // Put data into CMA buffer starting at offset 1 (base + 1) to match WASM semantics
      memcpy(buf_base + 1, data, size);
      PGLOG_ERROR("Data copied to CMA buffer at %p + 1 = %p (first 4 bytes: %02x %02x %02x %02x)", 
                         (void*)buf_base, (void*)(buf_base + 1), data[0], data[1], data[2], data[3]);
      use_wire(1);
      PGLOG_ERROR("Called use_wire(1)");
      interactive_write(static_cast<int>(size));
      PGLOG_ERROR("Called interactive_write(%d)", static_cast<int>(size));
      PGLOG_ERROR("About to call interactive_one() to process protocol message");
      interactive_one();
      PGLOG_ERROR("interactive_one() completed, reading response");
      // Read reply from CMA buffer 1 starting at (request_size + 2), mirroring WASM
      const int outCap = get_buffer_size(1);
      const int outLen = interactive_read();
      PGLOG_INFO("CMA reply outCap=%d outLen=%d", outCap, outLen);

      std::vector<uint8_t> out;
      if (outLen > 0 && outLen <= outCap) {
        const size_t start = static_cast<size_t>(size) + 2;
        const uint8_t* outBase = reinterpret_cast<uint8_t*>(static_cast<intptr_t>(get_buffer_addr(1)));
        if (start + static_cast<size_t>(outLen) <= static_cast<size_t>(outCap)) {
          out.assign(outBase + start, outBase + start + outLen);
          return out;
        } else {
          PGLOG_WARN("CMA reply slice oob: start=%zu len=%d cap=%d", start, outLen, outCap);
        }
      }
      // Fallback: if CMA reports 0 or oob, try file-mode .out
      if (fs::exists(pg_out)) {
        std::ifstream f(pg_out, std::ios::binary);
        f.seekg(0, std::ios::end);
        const auto len = static_cast<size_t>(f.tellg());
        f.seekg(0, std::ios::beg);
        out.resize(len);
        if (len) f.read(reinterpret_cast<char*>(out.data()),
                        static_cast<std::streamsize>(len));
        f.close();
        fs::remove(pg_out, ec);
        PGLOG_INFO("CMA fallback read file out len=%zu", out.size());
      }
      return out;
    } else {
      PGLOG_ERROR("CMA buffer too small, using file mode");
    }

  PGLOG_ERROR("Using file mode fallback");
  fs::rename(pg_lck_in, pg_in, ec);

  use_wire(1);
  interactive_write(0);
  interactive_one();

  std::vector<uint8_t> out;
  if (fs::exists(pg_out)) {
    std::ifstream f(pg_out, std::ios::binary);
    f.seekg(0, std::ios::end);
    const auto len = static_cast<size_t>(f.tellg());
    f.seekg(0, std::ios::beg);
    out.resize(len);
    if (len) f.read(reinterpret_cast<char*>(out.data()), static_cast<std::streamsize>(len));
    f.close();
    fs::remove(pg_out, ec);
  }
  return out;
}

std::vector<uint8_t> PGLiteRNNative::execProtocolRaw(
  const uint8_t* data,
  size_t size,
  const ExecProtocolOptionsNative& opts) {
  PGLOG_ERROR("execProtocolRaw called with size=%zu", size);
  PGLOG_ERROR("DEBUG: execProtocolRaw ENTRY - changes are compiled in!");
  std::lock_guard<std::mutex> lock(mtx_);
  PGLOG_ERROR("DEBUG: About to call ensureStarted_()");
  ensureStarted_();
  PGLOG_ERROR("About to call fileModeExecPtr_");
  return fileModeExecPtr_(data, size);
}

std::vector<uint8_t> PGLiteRNNative::fileModeExec_(
  const std::vector<uint8_t>& message) {
  // File-mode protocol aligned with wasm_common.h and interactive_one.c
  const std::string base = getEnvOr("PGDATA", defaultPgdata());
  ensureDir(base);

  const std::string pg_lck_in = base + "/.s.PGSQL.5432.lock.in";  // client input lock
  const std::string pg_in     = base + "/.s.PGSQL.5432.in";       // server reads
  const std::string pg_out    = base + "/.s.PGSQL.5432.out";      // server writes

  // Write request to lock file and atomically rename to .in
  {
    std::ofstream of(pg_lck_in, std::ios::binary | std::ios::trunc);
    of.write(reinterpret_cast<const char*>(message.data()), static_cast<std::streamsize>(message.size()));
    of.close();
  }
  std::error_code ec;
  // Remove existing .in if present to avoid rename failure
  fs::remove(pg_in, ec);
  fs::rename(pg_lck_in, pg_in, ec);

  // Signal file-mode (no CMA data) and pump one request
  use_wire(1);
  interactive_write(0);
  interactive_one();

  // Read reply from .out, if present
  std::vector<uint8_t> data;
  if (fs::exists(pg_out)) {
    std::ifstream f(pg_out, std::ios::binary);
    f.seekg(0, std::ios::end);
    const auto len = static_cast<size_t>(f.tellg());
    f.seekg(0, std::ios::beg);
    data.resize(len);
    if (len) f.read(reinterpret_cast<char*>(data.data()), static_cast<std::streamsize>(len));
    f.close();
    fs::remove(pg_out, ec);
  }
  return data;
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

