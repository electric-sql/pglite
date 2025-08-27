#include <NitroModules/ArrayBuffer.hpp>
#include <NitroModules/Promise.hpp>
#include <NitroModules/HybridObjectRegistry.hpp>
#include <android/log.h>
#include <fbjni/fbjni.h>
#include "PGLiteReactNative.hpp"
#include "RuntimeResources.hpp"
#include "../nitrogen/generated/shared/c++/HybridPGLiteNativeSpec.hpp"

using namespace margelo::nitro;

namespace margelo::nitro::electricsql::pglite {

class PGLiteReactNative : public HybridPGLiteNativeSpec {
public:
  PGLiteReactNative(): HybridObject(TAG) {}
  ~PGLiteReactNative() override = default;

  std::shared_ptr<Promise<std::shared_ptr<ArrayBuffer>>> execProtocolRaw(
      const std::shared_ptr<ArrayBuffer>& message,
      const std::optional<ExecProtocolOptionsNative>& options) override {
    // Copy message bytes on the JS thread before going async (Nitro requires this)
    std::vector<uint8_t> input;
    if (message) {
      const uint8_t* jsData = message->data();
      const size_t jsSize = message->size();
      input.assign(jsData, jsData + jsSize);
    }

    ::electricsql::pglite::ExecProtocolOptionsNative nativeOpts{};
    if (options.has_value() && options->syncToFs.has_value()) {
      nativeOpts.syncToFs = options->syncToFs.value();
    }

    return Promise<std::shared_ptr<ArrayBuffer>>::async([this, input = std::move(input), nativeOpts]() mutable {
      // Execute through existing native bridge (pointer/size)
      auto result = native_.execProtocolRaw(input.data(), input.size(), nativeOpts);
      // Return as ArrayBuffer (copy)
      return ArrayBuffer::copy(result);
    });
  }

  std::shared_ptr<Promise<void>> close() override {
    return Promise<void>::async([this]() {
      native_.close();
    });
  }

private:
  ::electricsql::pglite::PGLiteRNNative native_{};
};

} // namespace margelo::nitro::electricsql::pglite

extern "C" jint JNI_OnLoad(JavaVM* vm, void*) {
  __android_log_print(ANDROID_LOG_INFO, "PGLiteReactNative", "JNI_OnLoad called, registering HybridObject constructors...");
  facebook::jni::initialize(vm, [] {
    // Register an alias so both names work from JS: "PGLite" and "PGLiteNative"
    margelo::nitro::HybridObjectRegistry::registerHybridObjectConstructor(
      "PGLiteNative",
      []() -> std::shared_ptr<margelo::nitro::HybridObject> {
        return std::make_shared<margelo::nitro::electricsql::pglite::PGLiteReactNative>();
      }
    );
  });
  __android_log_print(ANDROID_LOG_INFO, "PGLiteReactNative", "JNI_OnLoad completed.");
  return JNI_VERSION_1_6;
}
