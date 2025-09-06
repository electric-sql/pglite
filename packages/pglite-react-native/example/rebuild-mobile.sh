#!/bin/bash

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
PLATFORM=${PLATFORM:-android}
ABI=${ABI:-arm64-v8a}
ARCH=${ARCH:-arm64-sim}  # For iOS: arm64-sim (Apple Silicon sim), arm64 (device), x86_64 (Intel sim)
API=${API:-27}       # For Android API level
PG_BRANCH=${PG_BRANCH:-REL_17_5_WASM}
SKIP_BUILD=${SKIP_BUILD:-false}
SKIP_INSTALL=${SKIP_INSTALL:-false}

# Paths (relative to script location)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PGLITE_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
POSTGRES_PGLITE_DIR="$PGLITE_ROOT/postgres-pglite"
REACT_NATIVE_DIR="$PGLITE_ROOT/packages/pglite-react-native"
EXAMPLE_DIR="$REACT_NATIVE_DIR/example"

print_step() {
    echo -e "${BLUE}==>${NC} ${YELLOW}$1${NC}"
}

print_success() {
    echo -e "${GREEN}✓${NC} $1"
}

print_error() {
    echo -e "${RED}✗${NC} $1"
}

print_info() {
    echo -e "${BLUE}ℹ${NC} $1"
}

check_command() {
    if ! command -v "$1" &> /dev/null; then
        print_error "$1 is required but not installed"
        exit 1
    fi
}

usage() {
    cat << EOF
Usage: $0 [OPTIONS]

Options:
    -p, --platform PLATFORM    Target platform (android, ios) (default: android)
    -a, --abi ABI              Android ABI (arm64-v8a, armeabi-v7a) (default: arm64-v8a)
    --arch ARCH                iOS architecture (arm64-sim, arm64, x86_64) (default: arm64-sim)
    --api API                  Android API level (default: 27)
    -b, --pg-branch BRANCH     PostgreSQL branch (default: REL_17_5_WASM)
    -s, --skip-build           Skip building pglite static libs
    -i, --skip-install         Skip npm/pnpm install steps
    -h, --help                 Show this help message

Examples:
    $0                          # Build Android with defaults
    $0 -p ios                   # Build iOS simulator (Apple Silicon)
    $0 -p ios --arch arm64      # Build iOS for device
    $0 -p ios --arch arm64-sim  # Build iOS simulator (Apple Silicon) - explicit
    $0 --skip-build             # Skip native lib build, just rebuild app
    $0 -p android -a arm64-v8a  # Android with specific ABI

Environment Variables:
    PLATFORM     Target platform (android, ios)
    ABI          Android ABI (arm64-v8a, armeabi-v7a, etc.)
    ARCH         iOS architecture (arm64-sim, arm64, x86_64)
    API          Android API level
    PG_BRANCH    PostgreSQL branch
    SKIP_BUILD   Skip native build (true/false)
    SKIP_INSTALL Skip install steps (true/false)
EOF
}

# Parse command line arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        -p|--platform)
            PLATFORM="$2"
            shift 2
            ;;
        -a|--abi)
            ABI="$2"
            shift 2
            ;;
        --arch)
            ARCH="$2"
            shift 2
            ;;
        --api)
            API="$2"
            shift 2
            ;;
        -b|--pg-branch)
            PG_BRANCH="$2"
            shift 2
            ;;
        -s|--skip-build)
            SKIP_BUILD=true
            shift
            ;;
        -i|--skip-install)
            SKIP_INSTALL=true
            shift
            ;;
        -h|--help)
            usage
            exit 0
            ;;
        *)
            print_error "Unknown option: $1"
            usage
            exit 1
            ;;
    esac
done

print_info "PGLite Mobile Rebuild Script"
if [[ "$PLATFORM" == "ios" ]]; then
    print_info "Platform: $PLATFORM, Arch: $ARCH, Branch: $PG_BRANCH"
else
    print_info "Platform: $PLATFORM, ABI: $ABI, API: $API, Branch: $PG_BRANCH"
fi
print_info "Skip Build: $SKIP_BUILD, Skip Install: $SKIP_INSTALL"
print_info "$PLATFORM directory will always be cleaned and rebuilt"
echo

# Check required commands
print_step "Checking dependencies"
check_command "nix"
if [[ "$SKIP_INSTALL" != "true" ]]; then
    check_command "pnpm"
    check_command "npm"
fi
check_command "npx"
check_command "adb"
print_success "All dependencies found"

# Step 1: Build pglite static libs for android (if not skipped)
if [[ "$SKIP_BUILD" != "true" ]]; then
    print_step "Building pglite static libs"
    if [[ ! -d "$POSTGRES_PGLITE_DIR" ]]; then
        print_error "postgres-pglite directory not found at $POSTGRES_PGLITE_DIR"
        exit 1
    fi
    
    cd "$POSTGRES_PGLITE_DIR"
    if [[ "$PLATFORM" == "ios" ]]; then
        print_info "Running: PLATFORM=$PLATFORM ARCH=$ARCH PG_BRANCH=$PG_BRANCH ./mobile-build/build-mobile.sh"
        PLATFORM="$PLATFORM" ARCH="$ARCH" PG_BRANCH="$PG_BRANCH" ./mobile-build/build-mobile.sh
    else
        print_info "Running: PLATFORM=$PLATFORM ABI=$ABI PG_BRANCH=$PG_BRANCH ./mobile-build/build-mobile.sh"
        PLATFORM="$PLATFORM" ABI="$ABI" PG_BRANCH="$PG_BRANCH" ./mobile-build/build-mobile.sh
    fi
    print_success "Static libs built and copied to pglite-react-native project"
else
    print_info "Skipping native lib build"
fi

# Step 2: Install dependencies in pglite-react-native (if not skipped)
if [[ "$SKIP_INSTALL" != "true" ]]; then
    print_step "Installing pglite-react-native dependencies"
    cd "$REACT_NATIVE_DIR"
    pnpm install
    print_success "pglite-react-native dependencies installed"
else
    print_info "Skipping pnpm install in pglite-react-native"
fi

# Step 3: Build pglite-react-native TypeScript code
print_step "Building pglite-react-native TypeScript code"
cd "$REACT_NATIVE_DIR"
pnpm build
print_success "pglite-react-native built successfully"

# Step 4: Setup example project
print_step "Setting up example project"
cd "$EXAMPLE_DIR"

# Install npm dependencies (first run or if not skipped)
if [[ "$SKIP_INSTALL" != "true" ]] || [[ ! -d "node_modules" ]]; then
    print_step "Installing example dependencies"
    npm install
    print_success "Example dependencies installed"
else
    print_info "Skipping npm install in example"
fi

# Platform-specific build steps
if [[ "$PLATFORM" == "ios" ]]; then
    # Clean iOS directory to ensure it's up to date
    if [[ -d "ios" ]]; then
        print_step "Cleaning generated iOS project"
        rm -rf ios
        print_success "iOS directory cleaned"
    fi

    # Generate native iOS project
    print_step "Generating native iOS project"
    npx expo prebuild -p ios --clean
    print_success "Native iOS project generated"

    print_info "iOS build ready!"
    print_info "Next steps:"
    print_info "1. Open ios/example.xcworkspace in Xcode"
    print_info "2. Select your device/simulator"
    print_info "3. Build and run (Cmd+R)"
else
    # Always clean android directory to ensure it's up to date
    if [[ -d "android" ]]; then
        print_step "Cleaning generated android project"
        rm -rf android
        print_success "Android directory cleaned"
    fi

    # Generate native android project
    print_step "Generating native android project"
    npx expo prebuild -p android --clean
    print_success "Native android project generated"

    # Build the APK
    print_step "Building APK"
    cd android
    ./gradlew assembleDebug
    print_success "APK built successfully"

    # Install APK on device
    print_step "Installing APK on device"
    APK_PATH="app/build/outputs/apk/debug/app-debug.apk"
    if [[ -f "$APK_PATH" ]]; then
        adb install "$APK_PATH"
        print_success "APK installed on device"
    else
        print_error "APK not found at $APK_PATH"
        exit 1
    fi
fi

# Return to example directory
cd "$EXAMPLE_DIR"

print_success "Mobile rebuild completed successfully!"
echo
print_info "Next steps:"
print_info "1. Run 'npx expo start -c' to start the React Native dev server"
print_info "2. Open the app on your emulator to test"
print_info "3. Use 'adb logcat' to view Android system logs"
print_info "4. For detailed backend logs:"
print_info "   - adb root"
print_info "   - adb shell"
print_info "   - run-as com.evelant.example"
print_info "   - cat files/pglite/runtime/initdb.stderr.log"
print_info "5. To clear data after a crash: rm -rf files/pglite/pgdata"
echo
print_info "To start the dev server automatically, run: $0 --start-server"

# Optional: Start the dev server automatically
if [[ "$1" == "--start-server" ]] || [[ "$START_SERVER" == "true" ]]; then
    print_step "Starting React Native dev server"
    npx expo start -c
fi