# @electric-sql/pglite-react-native

React Native adapter for PGlite. Uses a native-backed bridge for execProtocol to keep the RN API identical to @electric-sql/pglite.

## Resource bundling

- Android:
  - Place runtime files under `android/src/main/assets/pglite/share/postgresql/**`.
  - In your App `Application` class, call the env prep early:

```kotlin
class MyApp: Application() {
  override fun onCreate() {
    super.onCreate()
    com.electricsql.pglite.Env.applyRuntimeEnv(this)
  }
}
```

- iOS:
  - Place runtime files under `ios/RuntimeResources/PGLiteRuntime/share/postgresql/**`.
  - The Podspec bundles them and the native module copies them to Application Support.
  - Optionally call from your app, e.g. AppDelegate:

```swift
import PGLiteReactNative

func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
  PGLiteEnv.applyRuntimeEnv()
  return true
}
```

## Usage

```ts
import { PGlite } from '@electric-sql/pglite-react-native'

const db = new PGlite()
const result = await db.query('select 1 as n')
```

## Example app

See examples/minimal for a simple App.tsx demonstrating a `select 1` query.

## Smoke test

- The script at scripts/smoke-test.ts shows how to issue a minimal query.
- jest.smoke.ts provides a simple harness for RN-capable test runners.
