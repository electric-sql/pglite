Pod::Spec.new do |s|
  s.name         = "PGLiteReactNative"
  s.version      = "0.1.0"
  s.summary      = "PGLite React Native Module"
  s.homepage     = "https://github.com/electric-sql/pglite"
  s.license      = "Apache-2.0"
  s.author       = "Electric SQL"
  s.platform     = :ios, "14.0"

  s.source       = { :git => "https://github.com/electric-sql/pglite.git" }
  # s.source_files = "ios/**/*.{h,m,mm,swift}", "../cpp/**/*.{h,hpp,cpp}"

  s.source_files = [
    # Implementation (Swift)
    "ios/**/*.{swift}",
    # Autolinking/Registration (Objective-C++)
    "ios/**/*.{m,mm}",
    # Implementation (C++ objects)
    "cpp/**/*.{hpp,cpp}",
  ]
  s.vendored_libraries = ["ios/dist/libpgcore_mobile.a", "ios/dist/libpglite_glue_mobile.a"]

  s.dependency "React-Core"
  s.dependency "NitroModules"
  # Required for ExpoAppDelegateSubscriber
  # s.dependency "ExpoModulesCore"

  # Bundle runtime resources folder (PGLiteRuntime/share/postgresql/**)
  s.resources = ['ios/RuntimeResources']

  # Include Nitrogen-generated files and settings
  load 'nitrogen/generated/ios/PGLiteReactNative+autolinking.rb'
  add_nitrogen_files(s)
  
  s.dependency 'React-jsi'
  s.dependency 'React-callinvoker'
  install_modules_dependencies(s)


  # Add our custom config after nitrogen (will merge with existing)
  current_config = s.attributes_hash['pod_target_xcconfig'] || {}
  s.pod_target_xcconfig = current_config.merge({
    # 'CLANG_CXX_LIBRARY' => 'libc++',
    'GCC_PREPROCESSOR_DEFINITIONS' => '$(inherited) FOLLY_NO_CONFIG FOLLY_CFG_NO_COROUTINES PGLITE_MOBILE_HAS_NATIVE=1 PGL_MOBILE=1',
  })
end


