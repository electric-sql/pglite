#!/bin/bash

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

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

usage() {
    cat << EOF
Usage: $0 [COMMAND]

Commands:
    logs        Show filtered Android app logs (React Native, PGLite)
    all-logs    Show all Android system logs (unfiltered)
    backend     Show PGLite backend logs
    clear-data  Clear PGLite data directory
    devices     List connected devices
    shell       Open ADB shell as app user
    install     Install the debug APK
    uninstall   Uninstall the app
    start       Start the React Native dev server
    help        Show this help message

Examples:
    $0 logs                    # Show filtered app logs
    $0 all-logs                # Show all system logs
    $0 backend                 # Show backend logs
    $0 clear-data             # Clear app data for fresh start
    $0 devices                # List connected devices
EOF
}

check_device() {
    if ! adb devices | grep -q "device$"; then
        print_error "No Android device connected"
        print_info "Connect a device or start an emulator"
        exit 1
    fi
}

show_logs() {
    print_step "Showing Android app logs (Ctrl+C to stop)"
    check_device
    
    # Get the PID of the app to filter logs
    APP_PACKAGE="com.evelant.example"
    print_info "Filtering logs for package: $APP_PACKAGE"
    
    # Use logcat with package filter and some useful tags
    adb logcat --pid=$(adb shell pidof $APP_PACKAGE 2>/dev/null || echo "0") \
               ReactNative:V \
               ReactNativeJS:V \
               PGLite:V \
               System.err:V \
               AndroidRuntime:V \
               *:S 2>/dev/null || {
        print_info "App may not be running. Showing all logs with ReactNative filter..."
        adb logcat | grep -E "(ReactNative|PGLite|com.evelant.example)"
    }
}

show_all_logs() {
    print_step "Showing all Android system logs (Ctrl+C to stop)"
    check_device
    adb logcat
}

show_backend_logs() {
    print_step "Showing PGLite backend logs"
    check_device
    
    print_info "Getting root access..."
    if ! adb root 2>/dev/null; then
        print_error "Failed to get root access. Make sure you're using an emulator or rooted device"
        exit 1
    fi
    
    print_info "Opening shell as app user..."
    adb shell "run-as com.evelant.example cat files/pglite/runtime/initdb.stderr.log" 2>/dev/null || {
        print_error "Failed to read backend logs. App may not be installed or data may not exist yet."
        print_info "Try running the app first, then check logs again"
        exit 1
    }
}

clear_data() {
    print_step "Clearing PGLite data directory"
    check_device
    
    print_info "Getting root access..."
    if ! adb root 2>/dev/null; then
        print_error "Failed to get root access. Make sure you're using an emulator or rooted device"
        exit 1
    fi
    
    print_info "Removing pgdata directory..."
    adb shell "run-as com.evelant.example rm -rf files/pglite/pgdata" 2>/dev/null || {
        print_error "Failed to clear data. App may not be installed."
        exit 1
    }
    
    print_success "PGLite data cleared. Restart the app for a fresh database."
}

list_devices() {
    print_step "Connected devices"
    adb devices -l
}

open_shell() {
    print_step "Opening ADB shell as app user"
    check_device
    
    print_info "Getting root access..."
    if ! adb root 2>/dev/null; then
        print_error "Failed to get root access. Make sure you're using an emulator or rooted device"
        exit 1
    fi
    
    print_info "Opening shell (type 'exit' to return)..."
    adb shell "run-as com.evelant.example"
}

install_apk() {
    print_step "Installing debug APK"
    APK_PATH="android/app/build/outputs/apk/debug/app-debug.apk"
    
    if [[ ! -f "$APK_PATH" ]]; then
        print_error "APK not found at $APK_PATH"
        print_info "Run './rebuild-mobile.sh' first to build the APK"
        exit 1
    fi
    
    check_device
    adb install "$APK_PATH"
    print_success "APK installed successfully"
}

uninstall_app() {
    print_step "Uninstalling app"
    check_device
    adb uninstall com.evelant.example
    print_success "App uninstalled"
}

start_server() {
    print_step "Starting React Native dev server"
    npx expo start -c
}

# Main command handling
case "$1" in
    logs)
        show_logs
        ;;
    all-logs)
        show_all_logs
        ;;
    backend)
        show_backend_logs
        ;;
    clear-data)
        clear_data
        ;;
    devices)
        list_devices
        ;;
    shell)
        open_shell
        ;;
    install)
        install_apk
        ;;
    uninstall)
        uninstall_app
        ;;
    start)
        start_server
        ;;
    help|--help|-h|"")
        usage
        ;;
    *)
        print_error "Unknown command: $1"
        usage
        exit 1
        ;;
esac