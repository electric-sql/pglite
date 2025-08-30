import { NitroModules } from 'react-native-nitro-modules'
import type { PGLiteReactNative } from './PGLite.nitro'

/**
 * Returns the native PGLite HybridObject (Nitro) for low-level wire-protocol calls.
 * This is intentionally minimal; higher-level API is provided by @electric-sql/pglite.
 */
export function getPGLiteNative(): PGLiteReactNative {
  return NitroModules.createHybridObject<PGLiteReactNative>('PGLiteReactNative')
}
