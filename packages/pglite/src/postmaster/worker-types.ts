import type { ProcessHandle, ProcessScopePolicy } from './control.js'
import type { BrokeredFilesystemChannel } from './filesystem-broker.js'

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
  | {
      readonly kind: 'broker'
      readonly channel: BrokeredFilesystemChannel
    }

export type ProcessScopedMemoryMode = 'disabled' | 'dedicated' | 'compact'

export interface PostgresProcessWorkerData {
  readonly artifact: PostmasterArtifactPaths
  readonly wasmModule: WebAssembly.Module
  readonly privateInitialPages: number
  readonly privateMaximumPages: number
  readonly scopedInitialPages: number
  readonly scopedMaximumPages: number
  readonly globalMemory: WebAssembly.Memory
  readonly scopedMemory?: WebAssembly.Memory
  readonly scopedMemoryMode: ProcessScopedMemoryMode
  readonly scopePolicy: ProcessScopePolicy
  readonly scopeRoot?: ProcessHandle
  readonly controlBuffer: SharedArrayBuffer
  readonly connectionBuffers: readonly SharedArrayBuffer[]
  readonly process: ProcessHandle
  readonly postmaster: ProcessHandle
  readonly inheritedConnectionId: number
  readonly dataDirectory: string
  readonly filesystem: WorkerFilesystemDescriptor
  readonly arguments: readonly string[]
  readonly osUser: string
  readonly debug: boolean
}

export type PostgresProcessWorkerMessage =
  | {
      readonly type: 'filesystem-request'
      readonly pid: number
      readonly generation: number
      readonly sequence: number
    }
  | {
      readonly type: 'scoped-memory-ready'
      readonly pid: number
      readonly root: ProcessHandle
      readonly memory: WebAssembly.Memory
      readonly mode: Exclude<ProcessScopedMemoryMode, 'disabled'>
      readonly registryOffset: number
    }
  | { readonly type: 'runtime-ready'; readonly pid: number }
  | { readonly type: 'stdout'; readonly pid: number; readonly text: string }
  | { readonly type: 'stderr'; readonly pid: number; readonly text: string }
  | { readonly type: 'exit'; readonly pid: number; readonly code: number }
  | { readonly type: 'fatal'; readonly pid: number; readonly error: string }
