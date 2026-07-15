import type { PGliteClusterManifestV1 } from './initdb-runtime-contract.js'

export interface InitdbWorkerData {
  readonly dataDir: string
  readonly argv: readonly string[]
  readonly env: Readonly<Record<string, string | undefined>>
  readonly icuDataDir?: Blob
  readonly assets: {
    readonly postgresWasm: string
    readonly postgresData: string
    readonly initdbWasm: string
  }
  readonly coreVersion: string
}

export type InitdbWorkerMessage =
  | {
      readonly type: 'stdin'
      readonly response: SharedArrayBuffer
    }
  | {
      readonly type: 'stdout' | 'stderr'
      readonly data: Uint8Array
      readonly response: SharedArrayBuffer
    }
  | {
      readonly type: 'result'
      readonly exitCode: number
      readonly manifest?: PGliteClusterManifestV1
    }
  | {
      readonly type: 'error'
      readonly message: string
      readonly stack?: string
    }

export const STREAM_RESPONSE_STATE = 0
export const STREAM_RESPONSE_STATUS = 1
export const STREAM_RESPONSE_LENGTH = 2
export const STREAM_RESPONSE_HEADER_WORDS = 3
export const STREAM_CHUNK_BYTES = 64 * 1024
