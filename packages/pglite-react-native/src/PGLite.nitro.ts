import type { HybridObject } from 'react-native-nitro-modules'

// Minimal Nitro interface for native bridge.
// Keep complex API in TS (reuse @electric-sql/pglite BasePGlite) and only expose
// the low-level protocol bridge here for Nitrogen codegen.

export type ByteBuffer = ArrayBuffer
export interface ExecProtocolOptionsNative {
  syncToFs?: boolean
}

export interface PGLiteNative
  extends HybridObject<{ ios: 'swift'; android: 'kotlin' }> {
  execProtocolRaw(
    message: ByteBuffer,
    options?: ExecProtocolOptionsNative,
  ): Promise<ByteBuffer>
  close(): Promise<void>
}
