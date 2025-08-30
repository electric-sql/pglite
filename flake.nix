{
  description = "PGLite mobile build env";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";

  outputs = { self, nixpkgs }:
  let
    forAllSystems = f:
      nixpkgs.lib.genAttrs [ "aarch64-darwin" "x86_64-darwin" "x86_64-linux" ] (system:
        f (import nixpkgs { inherit system; config = { allowUnfree = true; android_sdk.accept_license = true; }; })
      );
  in {
    devShells = forAllSystems (pkgs:
      let
        android = pkgs.androidenv.composeAndroidPackages {
          platformVersions = [ "34" ];
          buildToolsVersions = [ "35.0.0" ];
          ndkVersions = [ "27.1.12297006" ];
          cmakeVersions = [ "3.22.1" ];
          includeEmulator = false;
          # Ensure NDK is included in the SDK closure
          includeNDK = true;
        };
        commonPkgs = with pkgs; [
          gnumake perl pkg-config coreutils gnused gawk python3
        ];
      in {
        android = pkgs.mkShell {
          packages = commonPkgs ++ [ android.androidsdk ];
          shellHook = ''
            export ANDROID_SDK_ROOT=${android.androidsdk}/libexec/android-sdk
            # Prefer standard ndk-bundle path if present (older layouts)
            if [ -d "$ANDROID_SDK_ROOT/ndk-bundle" ]; then
              export ANDROID_NDK_ROOT="$ANDROID_SDK_ROOT/ndk-bundle"
              export ANDROID_NDK="$ANDROID_NDK_ROOT"
            else
              # Try pinned version directory from composeAndroidPackages
              if [ -d "$ANDROID_SDK_ROOT/ndk/27.1.12297006" ]; then
                export ANDROID_NDK="$ANDROID_SDK_ROOT/ndk/27.1.12297006"
              else
                # Fallback: pick first ndk version
                first_ndk=$(ls -1 "$ANDROID_SDK_ROOT/ndk" 2>/dev/null | head -n1 || true)
                if [ -n "$first_ndk" ]; then export ANDROID_NDK="$ANDROID_SDK_ROOT/ndk/$first_ndk"; fi
              fi
            fi
            if [ -d "$ANDROID_NDK/toolchains/llvm/prebuilt" ]; then
              export PATH="$ANDROID_NDK/toolchains/llvm/prebuilt/*/bin:$PATH"
            elif [ -d "$ANDROID_NDK/toolchains/llvm/bin" ]; then
              export PATH="$ANDROID_NDK/toolchains/llvm/bin:$PATH"
            fi
            export MAKE=gmake
            echo "Android devShell ready: ANDROID_NDK=$ANDROID_NDK"
          '';
        };

        ios = pkgs.mkShell {
          packages = commonPkgs;
          shellHook = ''
            export MAKE=gmake
            echo "iOS devShell ready (requires Xcode/CLT for xcrun/SDKs)"
          '';
        };
      }
    );
  };
}

