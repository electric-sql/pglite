import { NitroModules } from 'react-native-nitro-modules'
import type { PGLiteNative } from './PGLite.nitro'

/**
 * Returns the native PGLite HybridObject (Nitro) for low-level wire-protocol calls.
 * This is intentionally minimal; higher-level API is provided by @electric-sql/pglite.
 */
export function getPGLiteNative(): PGLiteNative {
  // Try both registry names: generated C++ registers under "PGLite", while TAG is "PGLiteNative".
  try {
    return NitroModules.createHybridObject<PGLiteNative>('PGLiteNative')
  } catch (e) {
    console.warn(
      '[PGLite RN] createHybridObject("PGLiteNative") failed, falling back to "PGLite". Error:',
      e,
    )
    return NitroModules.createHybridObject<PGLiteNative>('PGLite')
  }
}
