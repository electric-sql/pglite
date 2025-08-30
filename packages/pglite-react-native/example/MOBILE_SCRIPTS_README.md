# PGLite Mobile Build and Debug Scripts

This directory contains automation scripts for building and testing the PGLite React Native implementation.

## Scripts

### `rebuild-mobile.sh` - Main Build Script

Automates the complete rebuild process for PGLite mobile implementation.

**Usage:**
```bash
./rebuild-mobile.sh [OPTIONS]
```

**Options:**
- `-p, --platform PLATFORM` - Target platform (default: android)
- `-a, --abi ABI` - Target ABI (default: arm64-v8a)
- `-b, --pg-branch BRANCH` - PostgreSQL branch (default: REL_17_5_WASM)
- `-s, --skip-build` - Skip building pglite static libs
- `-i, --skip-install` - Skip npm/pnpm install steps
- `-h, --help` - Show help message

**Note:** The Android directory is always cleaned and rebuilt to ensure it's up to date.

**Examples:**
```bash
# Full rebuild with defaults
./rebuild-mobile.sh

# Skip native build, just rebuild app
./rebuild-mobile.sh --skip-build

# Custom platform and ABI
./rebuild-mobile.sh -p android -a armeabi-v7a
```

**Environment Variables:**
You can also set these via environment variables:
- `PLATFORM` - Target platform
- `ABI` - Target ABI
- `PG_BRANCH` - PostgreSQL branch
- `SKIP_BUILD` - Skip native build (true/false)
- `SKIP_INSTALL` - Skip install steps (true/false)

### `debug-mobile.sh` - Debug Helper Script

Provides common debugging operations for mobile development.

**Usage:**
```bash
./debug-mobile.sh [COMMAND]
```

**Commands:**
- `logs` - Show filtered Android app logs (React Native, PGLite)
- `all-logs` - Show all Android system logs (unfiltered)
- `backend` - Show PGLite backend logs
- `clear-data` - Clear PGLite data directory
- `devices` - List connected devices
- `shell` - Open ADB shell as app user
- `install` - Install the debug APK
- `uninstall` - Uninstall the app
- `start` - Start the React Native dev server

**Examples:**
```bash
# View filtered app logs (recommended)
./debug-mobile.sh logs

# View all system logs (if needed for debugging)
./debug-mobile.sh all-logs

# View backend logs
./debug-mobile.sh backend

# Clear app data for fresh start
./debug-mobile.sh clear-data

# List connected devices
./debug-mobile.sh devices
```

## Prerequisites

Before using these scripts, ensure you have:

1. **Nix** - Required for building native libs
2. **pnpm** - For package management
3. **npm** - For React Native dependencies
4. **Android SDK/ADB** - For device communication
5. **Expo CLI** - For React Native build process

## Typical Workflow

1. **Full rebuild:**
   ```bash
   ./rebuild-mobile.sh
   ```

2. **Start dev server:**
   ```bash
   ./debug-mobile.sh start
   ```

3. **Monitor logs:**
   ```bash
   # In another terminal
   ./debug-mobile.sh logs
   ```

4. **Check backend logs if issues occur:**
   ```bash
   ./debug-mobile.sh backend
   ```

5. **Clear data if needed:**
   ```bash
   ./debug-mobile.sh clear-data
   ```

## What the Scripts Do

### rebuild-mobile.sh Process:

1. **Build native libs** (unless skipped):
   - Runs `mobile-build/build-mobile.sh` in postgres-pglite
   - Copies static libs to pglite-react-native project

2. **Install dependencies** (unless skipped):
   - `pnpm install` in packages/pglite-react-native
   - `npm install` in example directory

3. **Build TypeScript code:**
   - `pnpm build` in packages/pglite-react-native to compile TypeScript

4. **Generate native project:**
   - Always cleans android directory to ensure it's up to date
   - Runs `expo prebuild -p android --clean`

5. **Build APK:**
   - `./gradlew assembleDebug` in android directory

6. **Install on device:**
   - `adb install app-debug.apk`

### debug-mobile.sh Features:

- **Filtered app logs**: Shows only React Native and PGLite related logs for cleaner output
- **All system logs**: Unfiltered Android system logs when needed for deeper debugging
- **Backend logs**: PGLite-specific logs from app data directory
- **Data management**: Clear PGLite data for fresh starts
- **Device management**: List devices, install/uninstall app
- **Development**: Start React Native dev server

## Troubleshooting

- **No device found**: Ensure Android device/emulator is connected and debugging enabled
- **Build fails**: Check that all prerequisites are installed and Nix is working
- **Can't access backend logs**: Requires root access (emulator or rooted device)
- **APK not found**: Run full rebuild first

## Notes

- The scripts assume standard directory structure relative to the example folder
- Root access via `adb root` is required for backend log access
- Scripts include colored output and progress indicators for better UX
- All paths are calculated relative to script location for portability