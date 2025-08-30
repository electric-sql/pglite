# @electric-sql/pglite-react-native example (Expo + EAS)

This example demonstrates basic usage of PGlite in a React Native app and how to build it with EAS.

## Local development setup

Because the React Native package is not published yet, the example depends on local path packages and uses npm (Expo/EAS friendly).

1) Build the local packages (from the repo root):

```
pnpm -w -r --filter "@electric-sql/pg-protocol" build \
  && pnpm -w -r --filter "@electric-sql/pglite" build \
  && pnpm -w -r --filter "@electric-sql/pglite-react-native" build
```

2) Install example deps (from this folder):

```
cd packages/pglite-react-native/example
npm install
```

3) Start locally (optional):

```
npx expo start
```

## Build with EAS (Android development client)

- Ensure you are logged in: `eas whoami` (or `eas login`).
- The app is configured for New Architecture and `expo-dev-client`.

Run:

```
eas build -p android -e development
```

This will produce an internal dev build you can install on a device/simulator.

## Notes

- The example app imports and uses `@electric-sql/pglite-react-native` and runs a `select 1 as n` query on startup.
- The native module expects runtime resources to be available on-device. For simple smoke tests this may not be strictly required, but for full functionality:
  - Android: bundle `share/postgresql/**` under the module's `android/src/main/assets/pglite/share/postgresql/**`.
  - iOS: the podspec bundles resources and `PGLiteEnv.applyRuntimeEnv()` sets up paths on app launch.
- If you see runtime errors related to PGDATA/PGSYSCONFDIR, contact us or follow the resource bundling notes in the package README.

