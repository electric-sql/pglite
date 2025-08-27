Pod::Spec.new do |s|
  s.name         = "PGLiteReactNative"
  s.version      = "0.1.0"
  s.summary      = "PGLite React Native Module"
  s.homepage     = "https://github.com/electric-sql/pglite"
  s.license      = "Apache-2.0"
  s.author       = "Electric SQL"
  s.platform     = :ios, "13.0"

  s.source       = { :git => "https://github.com/electric-sql/pglite.git" }
  s.source_files = "ios/**/*.{h,m,mm,swift}", "../cpp/**/*.{h,hpp,cpp}"

  s.vendored_libraries = ["ios/dist/libpostgres_mobile.a", "ios/dist/libpglite_glue_mobile.a"]

  s.dependency "React-Core"
  s.dependency "NitroModules"

  # Include Nitrogen-generated files and settings
  load File.join(__dir__, '..', 'nitrogen/generated/ios/PGLiteReactNative+autolinking.rb')
  add_nitrogen_files(s)

  s.pod_target_xcconfig = {
    'CLANG_CXX_LANGUAGE_STANDARD' => 'c++17',
    'CLANG_CXX_LIBRARY' => 'libc++'
  }
end

  # Bundle runtime resources folder (PGLiteRuntime/share/postgresql/**)
  s.resources = ['ios/RuntimeResources/PGLiteRuntime/**/*']


