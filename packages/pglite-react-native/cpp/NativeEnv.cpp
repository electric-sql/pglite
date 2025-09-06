#ifdef __ANDROID__
#include <jni.h>
#include <cstdlib>
#include <string>
#include <android/log.h>

static void set_env_if_nonempty(const char* key, const std::string& val) {
  if (!val.empty()) {
    ::setenv(key, val.c_str(), 1);
  }
}

extern "C" JNIEXPORT void JNICALL
Java_com_electricsql_pglite_NativeEnv_applyEnv(
    JNIEnv* env,
    jclass /*clazz*/,
    jstring jRuntimeDir,
    jstring jDataDir,
    jstring jPgdata) {
  auto get = [&](jstring s) -> std::string {
    if (!s) return {};
    const char* chars = env->GetStringUTFChars(s, nullptr);
    std::string out = chars ? chars : "";
    if (chars) env->ReleaseStringUTFChars(s, chars);
    return out;
  };

  const std::string runtimeDir = get(jRuntimeDir);
  const std::string dataDir = get(jDataDir);
  const std::string pgdata = get(jPgdata);

  set_env_if_nonempty("ANDROID_RUNTIME_DIR", runtimeDir);
  set_env_if_nonempty("ANDROID_DATA_DIR", dataDir);
  set_env_if_nonempty("PGDATA", pgdata);
  // Point PGSYSCONFDIR to runtime/share/postgresql or to runtime root (C++ will refine)
  set_env_if_nonempty("PGSYSCONFDIR", runtimeDir);
  // WASM scripts use PGROOT to locate password (--pwfile=${PGROOT}/password). Mirror that here.
  set_env_if_nonempty("PGROOT", runtimeDir);
  // Provide a sane default user if none set upstream
  if (!getenv("PGUSER")) setenv("PGUSER", "postgres", 0);

  __android_log_print(ANDROID_LOG_INFO, "PGLiteReactNative",
    "NativeEnv.applyEnv ANDROID_RUNTIME_DIR=%s ANDROID_DATA_DIR=%s PGDATA=%s",
    runtimeDir.c_str(), dataDir.c_str(), pgdata.c_str());
}
#endif

