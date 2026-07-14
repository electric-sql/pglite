import type { ProcessHandle } from './control.js'

export interface PostmasterArtifactPaths {
  readonly wasm: string
  readonly glue: string
  readonly data: string
}

/**
 * A structured-cloneable description of a module that creates one ordinary
 * PGlite `Filesystem` instance inside each PostgreSQL process Worker.
 */
export interface WorkerFilesystemFactory {
  readonly module: string
  readonly export?: string
  readonly options?: unknown
}

export type WorkerFilesystemDescriptor =
  | { readonly kind: 'nodefs'; readonly root: string }
  | {
      readonly kind: 'factory'
      readonly factory: WorkerFilesystemFactory
    }

export interface PostgresProcessWorkerData {
  readonly artifact: PostmasterArtifactPaths
  readonly wasmModule: WebAssembly.Module
  readonly privateInitialPages: number
  readonly privateMaximumPages: number
  readonly globalMemory: WebAssembly.Memory
  readonly controlBuffer: SharedArrayBuffer
  readonly connectionBuffers: readonly SharedArrayBuffer[]
  readonly process: ProcessHandle
  readonly inheritedConnectionId: number
  readonly dataDirectory: string
  readonly filesystem: WorkerFilesystemDescriptor
  readonly arguments: readonly string[]
  readonly osUser: string
  readonly debug: boolean
}

export type PostgresProcessWorkerMessage =
  | { readonly type: 'runtime-ready'; readonly pid: number }
  | { readonly type: 'stdout'; readonly pid: number; readonly text: string }
  | { readonly type: 'stderr'; readonly pid: number; readonly text: string }
  | { readonly type: 'exit'; readonly pid: number; readonly code: number }
  | { readonly type: 'fatal'; readonly pid: number; readonly error: string }
