cmake_minimum_required(VERSION 3.9.0)

set (PACKAGE_NAME $$androidCxxLibName$$)
set (CMAKE_VERBOSE_MAKEFILE ON)
set (CMAKE_CXX_STANDARD 20)

# Enable Raw Props parsing in react-native (for Nitro Views)
add_compile_options(-DRN_SERIALIZABLE_STATE=1)

# Force shared STL BEFORE project() so Android toolchain picks it up
set(CMAKE_ANDROID_STL_TYPE c++_shared CACHE STRING "" FORCE)
set(ANDROID_STL c++_shared CACHE STRING "" FORCE)

project(PGLiteReactNative)

# Allow failing the build if native libs are missing (default: fail)
option(PGLITE_ALLOW_STUBS "Allow building with stub PGLite functions if native libs are missing" OFF)


# Allow EAS/Gradle to pass absolute paths via environment variables (no Gradle DSL needed)
if(NOT DEFINED PGLITE_DIST AND DEFINED ENV{PGLITE_DIST})
  set(PGLITE_DIST $ENV{PGLITE_DIST})
  message(STATUS "PGLITE_DIST from environment: ${PGLITE_DIST}")
endif()
if(NOT DEFINED PGLITE_ALLOW_STUBS AND DEFINED ENV{PGLITE_ALLOW_STUBS})
  set(PGLITE_ALLOW_STUBS ON)
  message(WARNING "PGLITE_ALLOW_STUBS enabled via environment")
endif()

add_library(PGLiteReactNative SHARED
  ../cpp/PGLiteReactNative.cpp
  ../cpp/RuntimeResources.cpp
  ../cpp/NativeEnv.cpp
  src/main/cpp/cpp-adapter.cpp
)

target_include_directories(PGLiteReactNative PUBLIC cpp)

target_compile_features(PGLiteReactNative PUBLIC cxx_std_20)

# Try to link prebuilt PostgreSQL + PGLite glue static archives if present.
# Priority 1: android/src/main/jni/${ANDROID_ABI}/lib*.a (checked into the RN module)
# Priority 2: ../../postgres-pglite/dist/mobile/android/${ANDROID_ABI}/lib/lib*.a (built locally)
if(ANDROID)
  # Allow caller to override via -DPGLITE_DIST=/custom/path
  if(NOT DEFINED PGLITE_DIST)
    set(PGLITE_DIST_JNI "${CMAKE_SOURCE_DIR}/src/main/jni/${ANDROID_ABI}")
    set(PGLITE_DIST_ALT "${CMAKE_SOURCE_DIR}/../../../postgres-pglite/dist/mobile/android/${ANDROID_ABI}")
    message(STATUS "Searching for PGLite libs in: \n  ${PGLITE_DIST_ALT}/lib \n  ${PGLITE_DIST_JNI}")
    # Prefer freshly built libs from postgres-pglite/dist over checked-in JNI copies
    if(EXISTS "${PGLITE_DIST_ALT}/lib/libpgcore_mobile.a" AND EXISTS "${PGLITE_DIST_ALT}/lib/libpglite_glue_mobile.a")
      set(PGLITE_DIST "${PGLITE_DIST_ALT}")
      set(PGLITE_LIBDIR "${PGLITE_DIST_ALT}/lib")
    elseif(EXISTS "${PGLITE_DIST_JNI}/libpgcore_mobile.a" AND EXISTS "${PGLITE_DIST_JNI}/libpglite_glue_mobile.a")
      set(PGLITE_DIST "${PGLITE_DIST_JNI}")
      set(PGLITE_LIBDIR "${PGLITE_DIST_JNI}")
    endif()
  else()
    # If user provided PGLITE_DIST, assume libs live directly inside it
    set(PGLITE_LIBDIR "${PGLITE_DIST}")
  endif()

  if(DEFINED PGLITE_LIBDIR)
    message(STATUS "Linking PGLite native libs from: ${PGLITE_LIBDIR}")
    # Resolve circular refs across static archives by grouping them so ld.lld can
    # iterate until all undefineds are satisfied. This mirrors how the WASM build
    # produces a monolithic core and avoids Android-only 1-pass archive resolution issues.
    target_link_libraries(PGLiteReactNative
      -Wl,--start-group
      ${PGLITE_LIBDIR}/libpglite_glue_mobile.a
      ${PGLITE_LIBDIR}/libpgcore_mobile.a
      -Wl,--end-group
    )
    # Allow duplicate pg_* symbols; prefer glue definitions (glue appears first in group)
    target_link_options(PGLiteReactNative PRIVATE -Wl,--allow-multiple-definition)

    add_compile_definitions(PGLITE_MOBILE_HAS_NATIVE=1)
    # Ensure wrapper TU also sees HAVE_SPINLOCKS, to avoid any fallback paths here
    target_compile_definitions(PGLiteReactNative PRIVATE HAVE_SPINLOCKS=1)
    set(PGLITE_NATIVE_LINKED 1)
  else()
    if(PGLITE_ALLOW_STUBS)
      message(WARNING "PGLite native prebuilt libs not found. Building with stub implementations (no real database).")
    else()
      message(FATAL_ERROR "PGLite native prebuilt libs not found. Provide -DPGLITE_DIST=...</lib> or copy libs to android/src/main/jni/${ANDROID_ABI}.")
    endif()
  endif()
endif()

# Ensure we link against shared C++ STL to satisfy Prefab packages (e.g., hermestooling)
find_library(CPP_SHARED c++_shared)
if(CPP_SHARED)
  target_link_libraries(PGLiteReactNative ${CPP_SHARED})
endif()

# Android logging and system libs (zlib)
if(ANDROID)
  find_library(ANDROID_LOG_LIB log)
  if(ANDROID_LOG_LIB)
    target_link_libraries(PGLiteReactNative ${ANDROID_LOG_LIB})
  endif()
  # zlib is required by PostgreSQL when built with --with-zlib (basebackup_gzip, etc.)
  find_library(ZLIB_LIB z)
  if(ZLIB_LIB)
    # Keep zlib after static archives so its symbols satisfy archive refs
    target_link_libraries(PGLiteReactNative ${ZLIB_LIB})
  endif()
endif()

# Define PGLITE_MOBILE_HAS_NATIVE=0 only if we didn't link native libs
if(NOT PGLITE_NATIVE_LINKED)
  add_compile_definitions(PGLITE_MOBILE_HAS_NATIVE=0)
endif()

# Add Nitrogen specs :)
include(${CMAKE_SOURCE_DIR}/../nitrogen/generated/android/PGLiteReactNative+autolinking.cmake)

# Set up local includes
include_directories(
        "src/main/cpp"
        "../cpp"
)
# # Include Nitrogen-generated autolinking for Android build
# if(ANDROID)
#   message(STATUS "Configuring Nitrogen autolinking (manual paths)...")
#   # Add Nitrogen include directories
#   include_directories(
#     "${CMAKE_SOURCE_DIR}/nitrogen/generated/shared/c++"
#     "${CMAKE_SOURCE_DIR}/nitrogen/generated/android/c++"
#     "${CMAKE_SOURCE_DIR}/nitrogen/generated/android"
#   )

#   # Add Nitrogen generated sources explicitly (absolute paths to avoid relative path issues)
#   target_sources(PGLiteReactNative PRIVATE
#     "${CMAKE_SOURCE_DIR}/nitrogen/generated/shared/c++/HybridPGLiteReactNativeSpec.cpp"
#     "${CMAKE_SOURCE_DIR}/nitrogen/generated/android/c++/JHybridPGLiteReactNativeSpec.cpp"
#   )

#   # Definitions required by RN/Folly
#   target_compile_definitions(PGLiteReactNative PRIVATE
#     FOLLY_NO_CONFIG=1
#     FOLLY_HAVE_CLOCK_GETTIME=1
#     FOLLY_USE_LIBCPP=1
#     FOLLY_CFG_NO_COROUTINES=1
#     FOLLY_MOBILE=1
#     FOLLY_HAVE_RECVMMSG=1
#     FOLLY_HAVE_PTHREAD=1
#     FOLLY_HAVE_XSI_STRERROR_R=1
#   )

#   # Link required Prefab packages
#   find_package(fbjni REQUIRED)
#   find_package(ReactAndroid REQUIRED)
#   find_package(react-native-nitro-modules REQUIRED)

#   target_link_libraries(PGLiteReactNative
#     fbjni::fbjni
#     ReactAndroid::jsi
#     react-native-nitro-modules::NitroModules
#   )

#   # Link react-native prefab depending on RN version
#   if(ReactAndroid_VERSION_MINOR GREATER_EQUAL 76)
#     target_link_libraries(PGLiteReactNative ReactAndroid::reactnative)
#   else()
#     target_link_libraries(PGLiteReactNative ReactAndroid::react_nativemodule_core)
#   endif()
# endif()

