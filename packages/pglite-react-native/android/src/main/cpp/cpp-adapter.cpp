#include <jni.h>
#include "PgLiteReactNativeOnLoad.hpp"

JNIEXPORT jint JNICALL JNI_OnLoad(JavaVM* vm, void*) {
  return margelo::nitro::electricsql::pglite::initialize(vm);
}