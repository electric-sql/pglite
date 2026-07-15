import type { ProcessHandle, ProcessScopePolicy } from '../shared/control.js'
import type { BrokeredFilesystemChannel } from './filesystem-broker.js'
import type { ProcessScopedMemoryMode } from '../shared/process-types.js'
import type {
  FilesystemCapabilities,
  PGliteClusterLeaseProvider,
} from '../../fs/base.js'
import type { PostgresSocketOperation } from '../shared/network-host.js'
export type { ProcessScopedMemoryMode } from '../shared/process-types.js'

export interface PostmasterArtifactPaths {
  readonly wasm: string
  readonly glue: string
  readonly data: string
}

export interface PostmasterExtensionFile {
  readonly path: string
  readonly bytes: SharedArrayBuffer
}

/** Immutable, verified extension input shared by every process Worker. */
export interface PostmasterExtensionSet {
  readonly namespaceOrder: readonly string[]
  readonly requiredSharedPreloadLibraries: readonly string[]
  readonly files: readonly PostmasterExtensionFile[]
  readonly sideModuleOrder: readonly string[]
  /** Dependency-free modules safe for Emscripten's eager preload plugin. */
  readonly sideModulePreloadOrder: readonly string[]
  readonly sideModulePaths: readonly (readonly [string, string])[]
  readonly pgliteEnv: Readonly<Record<string, string>>
  readonly artifactBytes: number
  readonly sideModuleBytes: number
  readonly configurationMilliseconds: number
  readonly preparationMilliseconds: number
}

/**
 * A structured-cloneable description of a module that creates one ordinary
 * PGlite `Filesystem` instance inside each PostgreSQL process Worker.
 */
export interface WorkerFilesystemFactory {
  readonly module: string
  readonly export?: string
  readonly options?: unknown
  readonly capabilities?: FilesystemCapabilities
  /** Supervisor-side lease implementation; never cloned into a Worker. */
  readonly clusterLeaseProvider?: PGliteClusterLeaseProvider
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

export interface PostgresProcessWorkerData {
  readonly artifact: PostmasterArtifactPaths
  readonly wasmModule: WebAssembly.Module
  /** One immutable package image shared by every Worker isolate. */
  readonly artifactData: SharedArrayBuffer
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
  readonly extensions: PostmasterExtensionSet
}

export type PostgresProcessWorkerMessage =
  | PostgresSocketOperation
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
  | {
      readonly type: 'runtime-ready'
      readonly pid: number
      readonly extensionLinkedDataBytes: number
    }
  | { readonly type: 'stdout'; readonly pid: number; readonly text: string }
  | { readonly type: 'stderr'; readonly pid: number; readonly text: string }
  | { readonly type: 'exit'; readonly pid: number; readonly code: number }
  | { readonly type: 'fatal'; readonly pid: number; readonly error: string }
