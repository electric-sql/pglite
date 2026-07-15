import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { measureMemory } from 'node:vm'
import { Worker } from 'node:worker_threads'
import type { Filesystem, PGliteClusterLease } from '../../fs/base.js'
import type { PGliteOptions } from '../../interface.js'
import { NodeFS } from '../../fs/nodefs.js'
import {
  acquireFilesystemClusterLease,
  inheritedClusterLease,
} from '../../fs/cluster-lease.js'
import { PGlite } from '../../pglite.js'
import { ConnectionTransport } from '../shared/connection.js'
import {
  PGLITE_SIGNALS,
  PostgresProcessKind,
  ProcessControlRegistry,
  ProcessExitKind,
  ProcessScopePolicy,
  ProcessState,
  VirtualConnectionTransport,
  type ProcessHandle,
  type SpawnRequest,
} from '../shared/control.js'
import {
  BrokeredFilesystemHost,
  initializerFilesystem,
  isBrokeredFilesystemBackend,
  type BrokeredFilesystemDiagnostics,
} from './filesystem-broker.js'
import { SupervisorTimers } from '../shared/timers.js'
import { VirtualConnectionBroker } from '../shared/virtual-listener.js'
import {
  PGlitePostmasterSession,
  type PGlitePostmasterSessionOptions,
} from '../shared/session.js'
import type {
  PostgresProcessWorkerData,
  PostgresProcessWorkerMessage,
  PostmasterArtifactPaths,
  WorkerFilesystemDescriptor,
  WorkerFilesystemFactory,
} from './worker-types.js'
import { assertPostmasterFilesystemSelection } from './filesystem-selection.js'
import { validateClusterFiles } from '../../cluster-manifest.js'
import { pgliteRuntimeIdentity } from '../../runtime-identity.js'
import {
  PostgresNodeNetworkHostController,
  registerPostgresNodeNetworkHostController,
} from './network-host.js'
import type {
  PGlitePostmasterExit,
  PGlitePostmasterShutdownMode,
  PGliteProtocolConnection,
  PGliteScopedMemoryMode,
  ProtocolPeerInfo,
} from '../types.js'

const WASM_PAGE_BYTES = 65_536
const ARTIFACT_PRIVATE_INITIAL_PAGES = 512
const ARTIFACT_GLOBAL_INITIAL_PAGES = 2
const ARTIFACT_MAXIMUM_PAGES = 16_384
const SHM_ALLOCATION_GENERATION_WORD_OFFSET = 5
const GLOBAL_SHM_ALLOCATION_GENERATION_WORD =
  (0x1_0000 >>> 2) + SHM_ALLOCATION_GENERATION_WORD_OFFSET
const SCOPED_SHM_MAGIC_READY = 0x5047_4c53
const SCOPED_SHM_REGISTRY_VERSION = 4
const SCOPED_SHM_SCOPE_DIRECTORY_OFFSET_WORDS = 18_464 >>> 2
const SCOPED_SHM_SCOPE_WORDS = 64 >>> 2
const SCOPED_SHM_MAX_SCOPES = 640
const RETIRED_BACKING_STORE_COLLECTION_INTERVAL = 128
const PGLITE_PROCESS_USER_ID = 123

export interface PGlitePostmasterOptions {
  /** Node directory, with the existing PGlite `file://` spelling supported. */
  readonly dataDir: string
  readonly maxConnections?: number
  readonly sharedBuffers?: string
  readonly artifact?: PostmasterArtifactPaths
  readonly workerUrl?: URL
  readonly debug?: boolean
  readonly initialize?: boolean
  readonly startParams?: readonly string[]
  /**
   * Keep settings owned by PGDATA instead of applying PGlite's managed
   * single-cluster defaults as command-line overrides. The process-host
   * portability settings remain enforced.
   */
  readonly respectPostgresqlConfig?: boolean
  /**
   * Existing synchronous PGlite `BaseFilesystem`. Without `workerFilesystem`,
   * it remains in the supervisor and is exposed to every process through a
   * bounded synchronous SAB broker.
   */
  readonly fs?: Filesystem
  /** Existing PGlite ICU data tarball used while initializing PGDATA. */
  readonly icuDataDir?: Blob | File
  /**
   * Alternatively creates an ordinary PGlite filesystem locally in every
   * process Worker. Its options must be structured-cloneable.
   */
  readonly workerFilesystem?: WorkerFilesystemFactory
  readonly privateInitialMemory?: number
  readonly privateMaximumMemory?: number
  readonly globalInitialMemory?: number
  readonly globalMaximumMemory?: number
  readonly scopedInitialMemory?: number
  readonly scopedMaximumMemory?: number
  /**
   * `compact` aliases a root backend's memories 0 and 2 and coordinates both
   * allocators through Emscripten's atomic sbrk frontier. `dedicated` retains
   * the stronger default isolation and independently reclaimable backing.
   */
  readonly scopedMemoryMode?: PGliteScopedMemoryMode
  /** OS identity presented to PostgreSQL for local-socket peer authentication. */
  readonly osUser?: string
  /**
   * Synthetic PID assigned to the postmaster. Test providers can set this to
   * the foreground host wrapper PID so postmaster.pid retains its usual
   * top-level process meaning.
   */
  readonly postmasterPid?: number
}

export interface PGlitePostmasterDiagnostics {
  readonly liveProcesses: number
  readonly livePrivateMemories: number
  readonly privateMemoriesStarted: number
  readonly privateMemoriesReleased: number
  readonly privateMemoryBytes: number
  readonly globalMemoryBytes: number
  readonly liveScopedMemories: number
  readonly scopedMemoriesStarted: number
  readonly scopedMemoriesReleased: number
  readonly scopedMemoryBytes: number
  readonly v8BackingStoreCollections: number
  readonly retiredScopedMemoriesAwaitingCollection: number
  readonly privateMemoryMaximumBytes: number
  readonly globalMemoryMaximumBytes: number
  readonly scopedMemoryMaximumBytes: number
  readonly globalShmAllocationGeneration: number
  readonly scopedMemoryMode: PGliteScopedMemoryMode
  readonly compactRootBindings: number
  /** Unique Wasm backing-store bytes, without double-counting compact roots. */
  readonly totalUniqueMemoryBytes: number
  readonly scopedLifetime: PGliteScopedLifetimeDiagnostics
  readonly filesystem: PGlitePostmasterFilesystemDiagnostics
}

export interface PGlitePostmasterFilesystemDiagnostics {
  readonly strategy: 'nodefs' | 'factory' | 'broker'
  readonly broker?: BrokeredFilesystemDiagnostics
}

export interface PGliteScopedLifetimeDiagnostics {
  readonly readyRoots: number
  /** Sum of allocation/release events across all currently ready roots. */
  readonly allocationGeneration: number
  readonly activeRootScopes: number
  readonly activeSessionScopes: number
  readonly activeTransactionScopes: number
  readonly activeSubtransactionScopes: number
  readonly activePortalScopes: number
  readonly activeQueryScopes: number
  readonly activeParallelContextScopes: number
  readonly closingScopes: number
  readonly deadScopes: number
  readonly attachments: number
  readonly activeWorkers: number
  /** Logically owned/reusable bytes, not the Wasm backing-store byteLength. */
  readonly allocatedBytes: number
}

interface WorkerRecord {
  readonly handle: ProcessHandle
  readonly worker: Worker
  readonly privateMemoryBytes: number
  readonly connectionId: number
  readonly scopePolicy: ProcessScopePolicy
  readonly scopeRoot?: ProcessHandle
  reportedExitCode?: number
  reportedExitKind?: ProcessExitKind
  settled: boolean
}

interface ScopedRootRecord {
  readonly handle: ProcessHandle
  readonly memory: WebAssembly.Memory
  readonly mode: PGliteScopedMemoryMode
  readonly registryOffset: number
  readonly members: Set<number>
  exited: boolean
}

type DirectWorkerFilesystemDescriptor = Exclude<
  WorkerFilesystemDescriptor,
  { readonly kind: 'broker' }
>

type ResolvedWorkerFilesystem =
  | {
      readonly kind: 'direct'
      readonly descriptor: DirectWorkerFilesystemDescriptor
    }
  | {
      readonly kind: 'broker'
      readonly host: BrokeredFilesystemHost
      readonly initializer: Filesystem
    }

export class PGlitePostmaster {
  readonly dataDir: string
  readonly maxConnections: number
  readonly globalMemory: WebAssembly.Memory
  readonly registry: ProcessControlRegistry

  private readonly artifact: PostmasterArtifactPaths
  private readonly wasmModule: WebAssembly.Module
  private readonly workerUrl: URL
  private readonly filesystem: ResolvedWorkerFilesystem
  private readonly clusterLease?: PGliteClusterLease
  private readonly privateInitialPages: number
  private readonly privateMaximumPages: number
  private readonly globalMaximumPages: number
  private readonly scopedInitialPages: number
  private readonly scopedMaximumPages: number
  private readonly scopedMemoryMode: PGliteScopedMemoryMode
  private readonly osUser: string
  private readonly debug: boolean
  private readonly postmasterProcess: ProcessHandle
  private readonly broker: VirtualConnectionBroker
  private readonly timers: SupervisorTimers
  private readonly networkHost = new PostgresNodeNetworkHostController()
  private readonly workers = new Map<number, WorkerRecord>()
  private readonly scopedRoots = new Map<number, ScopedRootRecord>()
  private readonly pendingStarts = new Set<Promise<void>>()
  private readonly sessions = new Set<PGlitePostmasterSession>()
  private closing = false
  private closed = false
  private closePromise?: Promise<void>
  private readonly postmasterExit: Promise<PGlitePostmasterExit>
  private resolvePostmasterExit!: (exit: PGlitePostmasterExit) => void
  private spawnLoop?: Promise<void>
  private timerLoop?: Promise<void>
  private privateMemoriesStarted = 0
  private privateMemoriesReleased = 0
  private scopedMemoriesStarted = 0
  private scopedMemoriesReleased = 0
  private v8BackingStoreCollections = 0
  private retiredScopedMemoriesAwaitingCollection = 0
  private backingStoreCollection?: Promise<void>

  private constructor(
    options: PGlitePostmasterOptions,
    dataDir: string,
    artifact: PostmasterArtifactPaths,
    wasmModule: WebAssembly.Module,
    filesystem: ResolvedWorkerFilesystem,
    clusterLease?: PGliteClusterLease,
  ) {
    this.dataDir = dataDir
    this.maxConnections = options.maxConnections ?? 20
    this.artifact = artifact
    this.wasmModule = wasmModule
    this.filesystem = filesystem
    this.clusterLease = clusterLease
    const memory = resolveMemoryOptions(options)
    this.privateInitialPages = memory.privateInitialPages
    this.privateMaximumPages = memory.privateMaximumPages
    this.globalMaximumPages = memory.globalMaximumPages
    this.scopedInitialPages = memory.scopedInitialPages
    this.scopedMaximumPages = memory.scopedMaximumPages
    this.scopedMemoryMode = options.scopedMemoryMode ?? 'dedicated'
    if (
      this.scopedMemoryMode !== 'dedicated' &&
      this.scopedMemoryMode !== 'compact'
    ) {
      throw new RangeError('scopedMemoryMode must be dedicated or compact')
    }
    this.osUser = options.osUser ?? 'postgres'
    if (this.osUser.length === 0 || this.osUser.includes('\0')) {
      throw new TypeError('osUser must be a non-empty string without NUL')
    }
    this.workerUrl =
      options.workerUrl ?? new URL('./process-worker.js', import.meta.url)
    this.debug = options.debug ?? false
    const maxProcesses = Math.max(32, this.maxConnections + 16)
    this.registry = ProcessControlRegistry.create(
      maxProcesses,
      options.postmasterPid,
    )
    this.globalMemory = createProcessMemory(
      memory.globalInitialPages,
      memory.globalMaximumPages,
    )
    this.postmasterProcess = this.registry.reserve(
      PostgresProcessKind.Postmaster,
    )
    this.postmasterExit = new Promise<PGlitePostmasterExit>((resolve) => {
      this.resolvePostmasterExit = resolve
    })
    this.registry.transition(this.postmasterProcess, ProcessState.Starting)
    this.broker = new VirtualConnectionBroker(
      this.registry,
      this.postmasterProcess,
    )
    this.timers = new SupervisorTimers(this.registry)
    registerPostgresNodeNetworkHostController(this, this.networkHost)
  }

  static async create(
    options: PGlitePostmasterOptions,
  ): Promise<PGlitePostmaster> {
    assertNodeCapabilities()
    const dataDir = resolveDataDirectory(options.dataDir)
    let filesystem: ResolvedWorkerFilesystem | undefined
    let clusterLease: PGliteClusterLease | undefined
    let ownsClusterLease = false
    try {
      const leaseFilesystem = resolveLeaseFilesystem(options, dataDir)
      const acquired = await acquireFilesystemClusterLease(
        leaseFilesystem,
        dataDir,
        'postmaster',
      )
      clusterLease = acquired.lease
      ownsClusterLease = acquired.owned
      filesystem = resolveWorkerFilesystem(options, dataDir)
      if (
        options.initialize !== false &&
        (options.fs !== undefined ||
          !existsSync(resolve(dataDir, 'PG_VERSION')))
      ) {
        const initializerOptions = {
          dataDir: `file://${dataDir}`,
          fs:
            filesystem.kind === 'broker' ? filesystem.initializer : options.fs,
          icuDataDir: options.icuDataDir,
          debug: options.debug ? 1 : 0,
        } as PGliteOptions & {
          [inheritedClusterLease]?: PGliteClusterLease
        }
        initializerOptions[inheritedClusterLease] = clusterLease
        const initializer = await PGlite.create(initializerOptions)
        await initializer.close()
      }
      if (!options.fs && !existsSync(resolve(dataDir, 'PG_VERSION'))) {
        throw new Error(`PGlite data directory is not initialized: ${dataDir}`)
      }
      if (!options.fs) validateNodeCluster(dataDir)
      if (!options.fs && existsSync(resolve(dataDir, 'postmaster.pid'))) {
        throw new Error(
          `PGlite data directory appears to be in use: ${dataDir}`,
        )
      }

      const artifact = resolveArtifact(options.artifact)
      const wasmModule = await WebAssembly.compile(readFileSync(artifact.wasm))
      const postmaster = new PGlitePostmaster(
        options,
        dataDir,
        artifact,
        wasmModule,
        filesystem,
        clusterLease,
      )
      try {
        await postmaster.start(options)
      } catch (error) {
        await postmaster.shutdown('immediate').catch(() => {})
        throw error
      }
      ownsClusterLease = false
      return postmaster
    } catch (error) {
      if (filesystem?.kind === 'broker') {
        await filesystem.host.close().catch(() => {})
      }
      if (ownsClusterLease) {
        await clusterLease?.release().catch(() => {})
      }
      throw error
    }
  }

  async openProtocolConnection(
    peer: ProtocolPeerInfo = { transport: 'tcp' },
  ): Promise<PGliteProtocolConnection> {
    this.assertOpen()
    const connection = this.broker.connect({
      transport:
        peer.transport === 'unix'
          ? VirtualConnectionTransport.Unix
          : VirtualConnectionTransport.Tcp,
      // The Wasm libc presents one synthetic process identity. Node's socket
      // API does not expose SO_PEERCRED, so local peer authentication models
      // a same-user client, which is also how the provider runs native tools.
      userId: PGLITE_PROCESS_USER_ID,
      groupId: PGLITE_PROCESS_USER_ID,
    })
    return new RawProtocolConnection(connection.transport, () =>
      this.broker.release(connection.handle.id),
    )
  }

  async createSession(
    options: PGlitePostmasterSessionOptions = {},
  ): Promise<PGlitePostmasterSession> {
    this.assertOpen()
    const connection = await this.openProtocolConnection({ transport: 'tcp' })
    const session = await PGlitePostmasterSession.create(
      connection,
      options,
      (closed) => this.sessions.delete(closed),
    )
    this.sessions.add(session)
    return session
  }

  diagnostics(): PGlitePostmasterDiagnostics {
    const live = [...this.workers.values()]
    const compactRoots = [...this.scopedRoots.values()].filter(
      ({ mode }) => mode === 'compact',
    )
    const dedicatedRoots = [...this.scopedRoots.values()].filter(
      ({ mode }) => mode === 'dedicated',
    )
    const livePids = new Set(live.map(({ handle }) => handle.pid))
    const baselinePrivateBytes = live.reduce(
      (total, record) => total + record.privateMemoryBytes,
      0,
    )
    const privateMemoryBytes =
      baselinePrivateBytes +
      compactRoots.reduce(
        (total, root) =>
          total +
          (livePids.has(root.handle.pid)
            ? Math.max(
                0,
                root.memory.buffer.byteLength -
                  this.privateInitialPages * WASM_PAGE_BYTES,
              )
            : root.memory.buffer.byteLength),
        0,
      )
    const scopedMemoryBytes = dedicatedRoots.reduce(
      (total, root) => total + root.memory.buffer.byteLength,
      0,
    )
    const scopedLifetime = readScopedLifetimeDiagnostics(
      this.scopedRoots.values(),
    )
    return {
      liveProcesses: live.length,
      livePrivateMemories: live.length,
      privateMemoriesStarted: this.privateMemoriesStarted,
      privateMemoriesReleased: this.privateMemoriesReleased,
      privateMemoryBytes,
      globalMemoryBytes: this.globalMemory.buffer.byteLength,
      liveScopedMemories: dedicatedRoots.length,
      scopedMemoriesStarted: this.scopedMemoriesStarted,
      scopedMemoriesReleased: this.scopedMemoriesReleased,
      scopedMemoryBytes,
      v8BackingStoreCollections: this.v8BackingStoreCollections,
      retiredScopedMemoriesAwaitingCollection:
        this.retiredScopedMemoriesAwaitingCollection,
      privateMemoryMaximumBytes: this.privateMaximumPages * WASM_PAGE_BYTES,
      globalMemoryMaximumBytes: this.globalMaximumPages * WASM_PAGE_BYTES,
      scopedMemoryMaximumBytes:
        (this.scopedMemoryMode === 'compact'
          ? this.privateMaximumPages
          : this.scopedMaximumPages) * WASM_PAGE_BYTES,
      globalShmAllocationGeneration: Atomics.load(
        new Uint32Array(this.globalMemory.buffer),
        GLOBAL_SHM_ALLOCATION_GENERATION_WORD,
      ),
      scopedMemoryMode: this.scopedMemoryMode,
      compactRootBindings: compactRoots.length,
      totalUniqueMemoryBytes:
        privateMemoryBytes +
        this.globalMemory.buffer.byteLength +
        scopedMemoryBytes,
      scopedLifetime,
      filesystem:
        this.filesystem.kind === 'broker'
          ? {
              strategy: 'broker',
              broker: this.filesystem.host.diagnostics(),
            }
          : { strategy: this.filesystem.descriptor.kind },
    }
  }

  close(): Promise<void> {
    return this.shutdown('smart')
  }

  shutdown(mode: PGlitePostmasterShutdownMode): Promise<void> {
    if (this.closed) return Promise.resolve()
    if (this.closePromise) return this.closePromise
    this.closing = true
    this.closePromise = this.finishShutdown(mode)
    return this.closePromise
  }

  reload(): void {
    this.assertOpen()
    if (this.registry.isCurrent(this.postmasterProcess)) {
      this.registry.queueSignalHandle(
        this.postmasterProcess,
        PGLITE_SIGNALS.SIGHUP,
      )
    }
  }

  waitForExit(): Promise<PGlitePostmasterExit> {
    return this.postmasterExit
  }

  private async finishShutdown(
    mode: PGlitePostmasterShutdownMode,
  ): Promise<void> {
    await Promise.allSettled(
      [...this.sessions].map((session) => session.close()),
    )
    this.timers.close()
    if (this.registry.isCurrent(this.postmasterProcess)) {
      this.registry.queueSignalHandle(
        this.postmasterProcess,
        mode === 'smart'
          ? PGLITE_SIGNALS.SIGTERM
          : mode === 'fast'
            ? PGLITE_SIGNALS.SIGINT
            : PGLITE_SIGNALS.SIGQUIT,
      )
    }
    const deadline = Date.now() + 5_000
    while (this.workers.size > 0 && Date.now() < deadline) {
      const sequence = this.registry.registryWakeSequence()
      await this.registry.waitForRegistryChangeAsync(sequence, 50)
    }
    await Promise.allSettled(
      [...this.workers.values()].map((record) => record.worker.terminate()),
    )
    await Promise.allSettled([...this.pendingStarts])
    await Promise.allSettled(
      [this.spawnLoop, this.timerLoop].filter(
        (loop): loop is Promise<void> => loop !== undefined,
      ),
    )
    await this.collectRetiredBackingStores(true)
    await this.networkHost.dispose()
    this.broker.close()
    let filesystemClosed = this.filesystem.kind === 'direct'
    try {
      if (this.filesystem.kind === 'broker') {
        await this.filesystem.host.close()
        filesystemClosed = true
      }
    } finally {
      try {
        if (filesystemClosed) await this.clusterLease?.release()
      } finally {
        this.closed = true
        this.closing = false
      }
    }
  }

  async [Symbol.asyncDispose](): Promise<void> {
    await this.close()
  }

  private async start(options: PGlitePostmasterOptions): Promise<void> {
    this.spawnLoop = this.runSpawnLoop()
    this.timerLoop = this.timers.run()
    await this.startWorker(
      this.postmasterProcess,
      0,
      postmasterArguments(options, this.maxConnections),
      ProcessScopePolicy.SelfAlias,
    )
  }

  private async runSpawnLoop(): Promise<void> {
    while (!this.closing && !this.closed) {
      const request = await this.registry.waitForSpawn(250)
      if (!request) continue
      const start = this.startRequestedWorker(request)
      this.pendingStarts.add(start)
      void start.finally(() => this.pendingStarts.delete(start))
    }
  }

  private async startRequestedWorker(request: SpawnRequest): Promise<void> {
    try {
      await this.startWorker(
        request.handle,
        request.connectionId,
        [`--forkchild=${request.childKind}`, request.parameterFile],
        request.scopePolicy,
        request.scopeRoot,
      )
      this.registry.completeSpawn(request)
    } catch (error) {
      this.registry.failSpawn(request)
      console.error(
        `[postgres:${request.handle.pid}] Worker startup failed`,
        error,
      )
    }
  }

  private async startWorker(
    handle: ProcessHandle,
    connectionId: number,
    args: readonly string[],
    scopePolicy: ProcessScopePolicy,
    scopeRoot?: ProcessHandle,
  ): Promise<void> {
    let scopedMemory: WebAssembly.Memory | undefined
    let inheritedRoot: ScopedRootRecord | undefined
    if (
      scopePolicy === ProcessScopePolicy.InheritRoot ||
      scopePolicy === ProcessScopePolicy.AttachRoot
    ) {
      if (!scopeRoot) throw new Error('scoped child has no root handle')
      inheritedRoot = this.scopedRoots.get(scopeRoot.pid)
      if (
        !inheritedRoot ||
        inheritedRoot.exited ||
        inheritedRoot.handle.generation !== scopeRoot.generation
      ) {
        throw new Error(`scoped root ${scopeRoot.pid} is not live`)
      }
      scopedMemory = inheritedRoot.memory
    } else if (scopePolicy === ProcessScopePolicy.NewRoot) {
      if (
        !scopeRoot ||
        scopeRoot.pid !== handle.pid ||
        scopeRoot.generation !== handle.generation
      ) {
        throw new Error('new scoped root does not match its Worker')
      }
    } else if (scopeRoot) {
      throw new Error('SelfAlias Worker unexpectedly has a scope root')
    }
    let workerFilesystem: WorkerFilesystemDescriptor
    if (this.filesystem.kind === 'broker') {
      workerFilesystem = {
        kind: 'broker',
        channel: this.filesystem.host.attach(handle),
      }
    } else {
      workerFilesystem = this.filesystem.descriptor
    }
    const workerData: PostgresProcessWorkerData = {
      artifact: this.artifact,
      wasmModule: this.wasmModule,
      privateInitialPages: this.privateInitialPages,
      privateMaximumPages: this.privateMaximumPages,
      scopedInitialPages: this.scopedInitialPages,
      scopedMaximumPages: this.scopedMaximumPages,
      globalMemory: this.globalMemory,
      scopedMemory,
      scopedMemoryMode:
        scopePolicy === ProcessScopePolicy.SelfAlias
          ? 'disabled'
          : this.scopedMemoryMode,
      scopePolicy,
      scopeRoot,
      controlBuffer: this.registry.buffer,
      connectionBuffers: this.broker.buffers,
      process: handle,
      postmaster: this.postmasterProcess,
      inheritedConnectionId: connectionId,
      dataDirectory: this.dataDir,
      filesystem: workerFilesystem,
      arguments: args,
      osUser: this.osUser,
      debug: this.debug,
    }
    let worker: Worker
    try {
      worker = new Worker(this.workerUrl, { workerData })
    } catch (error) {
      if (this.filesystem.kind === 'broker') {
        this.filesystem.host.detach(handle)
      }
      throw error
    }
    const record: WorkerRecord = {
      handle,
      worker,
      privateMemoryBytes: this.privateInitialPages * WASM_PAGE_BYTES,
      connectionId,
      scopePolicy,
      scopeRoot,
      settled: false,
    }
    inheritedRoot?.members.add(handle.pid)
    this.privateMemoriesStarted++
    this.workers.set(handle.pid, record)

    await new Promise<void>((resolveReady, rejectReady) => {
      let ready = false
      let rootMemoryReady = scopePolicy !== ProcessScopePolicy.NewRoot
      const startupTimer = setTimeout(() => {
        if (!ready) {
          record.reportedExitCode = 1
          void worker.terminate()
          rejectReady(
            new Error(`PostgreSQL Worker ${handle.pid} startup timed out`),
          )
        }
      }, 30_000)

      worker.on('message', (message: PostgresProcessWorkerMessage) => {
        if (
          message.type === 'network-bind' ||
          message.type === 'network-configure-unix' ||
          message.type === 'network-listen' ||
          message.type === 'network-close'
        ) {
          this.networkHost.dispatch(message, handle)
        } else if (message.type === 'filesystem-request') {
          if (
            this.filesystem.kind !== 'broker' ||
            message.pid !== handle.pid ||
            message.generation !== handle.generation ||
            !Number.isSafeInteger(message.sequence) ||
            message.sequence <= 0
          ) {
            record.reportedExitCode = 1
            record.reportedExitKind = ProcessExitKind.WorkerFailure
            void worker.terminate()
            return
          }
          this.filesystem.host.dispatch(handle, message.sequence)
        } else if (message.type === 'scoped-memory-ready') {
          if (
            rootMemoryReady ||
            scopePolicy !== ProcessScopePolicy.NewRoot ||
            !scopeRoot ||
            message.pid !== handle.pid ||
            message.root.pid !== scopeRoot.pid ||
            message.root.generation !== scopeRoot.generation ||
            message.mode !== this.scopedMemoryMode ||
            !Number.isInteger(message.registryOffset) ||
            message.registryOffset <= 0 ||
            message.registryOffset >= 0x4000_0000
          ) {
            record.reportedExitCode = 1
            record.reportedExitKind = ProcessExitKind.WorkerFailure
            void worker.terminate()
            return
          }
          const root: ScopedRootRecord = {
            handle: scopeRoot,
            memory: message.memory,
            mode: message.mode,
            registryOffset: message.registryOffset,
            members: new Set([handle.pid]),
            exited: false,
          }
          this.scopedRoots.set(scopeRoot.pid, root)
          if (message.mode === 'dedicated') this.scopedMemoriesStarted++
          rootMemoryReady = true
        } else if (message.type === 'runtime-ready') {
          if (!rootMemoryReady) {
            record.reportedExitCode = 1
            record.reportedExitKind = ProcessExitKind.WorkerFailure
            void worker.terminate()
            rejectReady(
              new Error(
                `PostgreSQL Worker ${handle.pid} omitted scoped memory`,
              ),
            )
            return
          }
          ready = true
          clearTimeout(startupTimer)
          if (this.debug)
            console.log(`[postgres:${message.pid}] Worker runtime ready`)
          resolveReady()
        } else if (message.type === 'exit') {
          record.reportedExitCode = message.code
          // A PostgreSQL process that deliberately proc_exit()s has exited
          // normally even when its Unix exit status is non-zero. Preserve
          // buffered protocol errors and let the postmaster interpret that
          // status; only failures of the Worker host itself abort the ring.
          record.reportedExitKind = ProcessExitKind.Normal
          if (this.debug)
            console.log(
              `[postgres:${message.pid}] Worker process exited (${message.code})`,
            )
          // Emscripten can retain timers after callMain() has completed. The
          // explicit process-exit message is authoritative and is sent only
          // after the PostgreSQL host adapters have finished their cleanup.
          // Keep the process registered until the Node Worker has actually
          // exited: that preserves waitpid/max_connections backpressure and
          // prevents rapid reconnects from accumulating terminating Workers
          // and their private Wasm memories.
          void worker.terminate()
        } else if (message.type === 'fatal') {
          if (!ready) {
            clearTimeout(startupTimer)
            rejectReady(new Error(message.error))
          }
          record.reportedExitCode = 1
          record.reportedExitKind = ProcessExitKind.WorkerFailure
          void worker.terminate()
          if (this.debug) console.error(message.error)
        } else if (message.type === 'stderr') {
          console.error(`[postgres:${message.pid}] ${message.text}`)
        } else if (this.debug) {
          console.log(`[postgres:${message.pid}] ${message.text}`)
        }
      })
      worker.once('error', (error) => {
        if (!ready) {
          clearTimeout(startupTimer)
          rejectReady(error)
        }
        record.reportedExitCode = 1
        record.reportedExitKind = ProcessExitKind.WorkerFailure
      })
      worker.once('exit', (code) => {
        if (!ready) {
          clearTimeout(startupTimer)
          rejectReady(
            new Error(
              `PostgreSQL Worker ${handle.pid} exited during startup (${code})`,
            ),
          )
        }
        const processExitCode = record.reportedExitCode ?? code
        this.settleWorker(
          record,
          record.reportedExitKind ??
            (code === 0
              ? ProcessExitKind.Normal
              : ProcessExitKind.WorkerFailure),
          processExitCode,
        )
      })
    })
  }

  private settleWorker(
    record: WorkerRecord,
    exitKind: ProcessExitKind,
    exitCode: number,
  ): void {
    if (record.settled) return
    record.settled = true
    this.workers.delete(record.handle.pid)
    this.networkHost.processExited(record.handle)
    if (this.filesystem.kind === 'broker') {
      this.filesystem.host.detach(record.handle)
    }
    this.privateMemoriesReleased++
    this.settleScopedMembership(record)
    if (exitKind === ProcessExitKind.WorkerFailure && record.connectionId) {
      this.broker.abort(record.connectionId, 1)
    }
    this.registry.markExit(record.handle, exitKind, exitCode)
    if (record.handle.pid === this.postmasterProcess.pid) {
      this.resolvePostmasterExit({ exitKind, exitCode })
    }
    record.worker.removeAllListeners()
  }

  private settleScopedMembership(record: WorkerRecord): void {
    const rootHandle = record.scopeRoot
    if (!rootHandle) return
    const root = this.scopedRoots.get(rootHandle.pid)
    if (!root || root.handle.generation !== rootHandle.generation) return

    root.members.delete(record.handle.pid)
    if (
      record.scopePolicy === ProcessScopePolicy.NewRoot &&
      record.handle.pid === root.handle.pid &&
      record.handle.generation === root.handle.generation
    ) {
      root.exited = true
      // A scoped-memory root owns the backing store, not the lifetime of
      // every process attached to it.  In particular, bgw_notify_pid asks
      // PostgreSQL to notify a registering backend when a dynamic background
      // worker starts or stops; it does not make that worker a child that
      // dies with the registering backend.  Keep the root memory alive until
      // its final attached process exits and let PostgreSQL's postmaster
      // decide which workers must be signalled or terminated.
    }
    if (root.exited && root.members.size === 0) {
      this.scopedRoots.delete(root.handle.pid)
      if (root.mode === 'dedicated') this.scopedMemoriesReleased++
      this.retiredScopedMemoriesAwaitingCollection++
      void this.collectRetiredBackingStores()
    }
  }

  private async collectRetiredBackingStores(force = false): Promise<void> {
    if (this.backingStoreCollection) {
      if (!force) return
      await this.backingStoreCollection
    }
    if (
      this.retiredScopedMemoriesAwaitingCollection === 0 ||
      (!force &&
        this.retiredScopedMemoriesAwaitingCollection <
          RETIRED_BACKING_STORE_COLLECTION_INTERVAL)
    ) {
      return
    }

    this.retiredScopedMemoriesAwaitingCollection = 0
    const collection = measureMemory({
      mode: 'summary',
      execution: 'eager',
    }).then(() => {
      this.v8BackingStoreCollections++
    })
    this.backingStoreCollection = collection
    try {
      await collection
    } finally {
      if (this.backingStoreCollection === collection) {
        this.backingStoreCollection = undefined
      }
    }
    if (
      force ||
      this.retiredScopedMemoriesAwaitingCollection >=
        RETIRED_BACKING_STORE_COLLECTION_INTERVAL
    ) {
      await this.collectRetiredBackingStores(force)
    }
  }

  private assertOpen(): void {
    if (this.closing || this.closed)
      throw new Error('PGlite postmaster is closed')
  }
}

function validateNodeCluster(dataDir: string): void {
  const manifestPath = resolve(dataDir, '.pglite', 'cluster.json')
  validateClusterFiles(
    {
      pgVersion: readFileSync(resolve(dataDir, 'PG_VERSION'), 'utf8'),
      control: readFileSync(resolve(dataDir, 'global', 'pg_control')),
      manifest: existsSync(manifestPath)
        ? readFileSync(manifestPath, 'utf8')
        : undefined,
    },
    pgliteRuntimeIdentity.artifacts.postmaster,
    pgliteRuntimeIdentity.blockSize,
    pgliteRuntimeIdentity.walBlockSize,
  )
}

function readScopedLifetimeDiagnostics(
  roots: Iterable<ScopedRootRecord>,
): PGliteScopedLifetimeDiagnostics {
  let readyRoots = 0
  let allocationGeneration = 0
  let activeRootScopes = 0
  let activeSessionScopes = 0
  let activeTransactionScopes = 0
  let activeSubtransactionScopes = 0
  let activePortalScopes = 0
  let activeQueryScopes = 0
  let activeParallelContextScopes = 0
  let closingScopes = 0
  let deadScopes = 0
  let attachments = 0
  let activeWorkers = 0
  let allocatedBytes = 0

  for (const root of roots) {
    const words = new Uint32Array(root.memory.buffer)
    const registryWord = root.registryOffset >>> 2
    if (
      registryWord +
        SCOPED_SHM_SCOPE_DIRECTORY_OFFSET_WORDS +
        SCOPED_SHM_MAX_SCOPES * SCOPED_SHM_SCOPE_WORDS >
        words.length ||
      Atomics.load(words, registryWord) !== SCOPED_SHM_MAGIC_READY ||
      Atomics.load(words, registryWord + 1) !== SCOPED_SHM_REGISTRY_VERSION
    ) {
      continue
    }
    readyRoots++
    allocationGeneration += Atomics.load(
      words,
      registryWord + SHM_ALLOCATION_GENERATION_WORD_OFFSET,
    )
    for (let slot = 0; slot < SCOPED_SHM_MAX_SCOPES; slot++) {
      const offset =
        registryWord +
        SCOPED_SHM_SCOPE_DIRECTORY_OFFSET_WORDS +
        slot * SCOPED_SHM_SCOPE_WORDS
      const state = Atomics.load(words, offset)
      const kind = Atomics.load(words, offset + 1)
      if (state === 1) {
        if (kind === 1) activeRootScopes++
        else if (kind === 2) activeSessionScopes++
        else if (kind === 3) activeTransactionScopes++
        else if (kind === 4) activeSubtransactionScopes++
        else if (kind === 5) activePortalScopes++
        else if (kind === 6) activeQueryScopes++
        else if (kind === 7) activeParallelContextScopes++
      } else if (state === 2) {
        closingScopes++
      } else if (state === 3) {
        deadScopes++
      }
      if (state !== 1 && state !== 2) continue
      attachments += Atomics.load(words, offset + 6)
      activeWorkers += Atomics.load(words, offset + 7)
      allocatedBytes +=
        Atomics.load(words, offset + 10) +
        Atomics.load(words, offset + 11) * 0x1_0000_0000
    }
  }

  return {
    readyRoots,
    allocationGeneration,
    activeRootScopes,
    activeSessionScopes,
    activeTransactionScopes,
    activeSubtransactionScopes,
    activePortalScopes,
    activeQueryScopes,
    activeParallelContextScopes,
    closingScopes,
    deadScopes,
    attachments,
    activeWorkers,
    allocatedBytes,
  }
}

class RawProtocolConnection implements PGliteProtocolConnection {
  readonly readable: AsyncIterable<Uint8Array>
  readonly closed: Promise<void>
  private readonly frontendClosed: Promise<void>
  private markFrontendClosed!: () => void

  constructor(
    private readonly transport: ConnectionTransport,
    release: () => void,
  ) {
    this.readable = transport.readable()
    this.closed = transport.waitForClose()
    this.frontendClosed = new Promise<void>((resolve) => {
      this.markFrontendClosed = resolve
    })
    void Promise.allSettled([this.closed, this.frontendClosed]).then(release)
  }

  write(data: Uint8Array): Promise<void> {
    return this.transport.write(data)
  }

  async end(): Promise<void> {
    try {
      this.transport.end()
    } catch (error) {
      if (!isStaleConnectionError(error)) throw error
    } finally {
      this.markFrontendClosed()
    }
  }

  abort(_reason?: unknown): void {
    try {
      this.transport.abort()
    } catch (error) {
      if (!isStaleConnectionError(error)) throw error
    } finally {
      this.markFrontendClosed()
    }
  }
}

function isStaleConnectionError(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.message === 'stale PGlite connection transport'
  )
}

function resolveWorkerFilesystem(
  options: PGlitePostmasterOptions,
  dataDir: string,
): ResolvedWorkerFilesystem {
  assertPostmasterFilesystemSelection(options.fs, options.workerFilesystem)
  if (!options.workerFilesystem) {
    if (options.fs) {
      if (!isBrokeredFilesystemBackend(options.fs)) {
        throw new TypeError(
          'A custom postmaster fs must implement the synchronous BaseFilesystem operations or provide a workerFilesystem factory',
        )
      }
      const host = new BrokeredFilesystemHost(options.fs)
      return {
        kind: 'broker',
        host,
        initializer: initializerFilesystem(options.fs),
      }
    }
    return {
      kind: 'direct',
      descriptor: { kind: 'nodefs', root: dataDir },
    }
  }
  const factory = options.workerFilesystem
  const { clusterLeaseProvider: _clusterLeaseProvider, ...workerFactory } =
    factory
  let module = factory.module
  if (module.startsWith('.') || module.startsWith('/')) {
    module = pathToFileURL(resolve(module)).href
  }
  try {
    structuredClone(factory.options)
  } catch {
    throw new TypeError('workerFilesystem options must be structured-cloneable')
  }
  return {
    kind: 'direct',
    descriptor: {
      kind: 'factory',
      factory: { ...workerFactory, module },
    },
  }
}

function resolveLeaseFilesystem(
  options: PGlitePostmasterOptions,
  dataDir: string,
): Filesystem {
  if (options.fs) return options.fs
  if (!options.workerFilesystem) return new NodeFS(dataDir)

  return {
    capabilities: options.workerFilesystem.capabilities,
    clusterLeaseProvider: options.workerFilesystem.clusterLeaseProvider,
  } as Filesystem
}

interface ResolvedMemoryOptions {
  privateInitialPages: number
  privateMaximumPages: number
  globalInitialPages: number
  globalMaximumPages: number
  scopedInitialPages: number
  scopedMaximumPages: number
}

function resolveMemoryOptions(
  options: PGlitePostmasterOptions,
): ResolvedMemoryOptions {
  const privateInitialPages = memoryPages(
    options.privateInitialMemory,
    ARTIFACT_PRIVATE_INITIAL_PAGES,
    'privateInitialMemory',
  )
  const privateMaximumPages = memoryPages(
    options.privateMaximumMemory,
    ARTIFACT_MAXIMUM_PAGES,
    'privateMaximumMemory',
  )
  const globalInitialPages = memoryPages(
    options.globalInitialMemory,
    ARTIFACT_GLOBAL_INITIAL_PAGES,
    'globalInitialMemory',
  )
  const globalMaximumPages = memoryPages(
    options.globalMaximumMemory,
    ARTIFACT_MAXIMUM_PAGES,
    'globalMaximumMemory',
  )
  const scopedInitialPages = memoryPages(
    options.scopedInitialMemory,
    ARTIFACT_GLOBAL_INITIAL_PAGES,
    'scopedInitialMemory',
  )
  const scopedMaximumPages = memoryPages(
    options.scopedMaximumMemory,
    ARTIFACT_MAXIMUM_PAGES,
    'scopedMaximumMemory',
  )
  if (privateInitialPages < ARTIFACT_PRIVATE_INITIAL_PAGES) {
    throw new RangeError('privateInitialMemory is below the artifact minimum')
  }
  if (globalInitialPages < ARTIFACT_GLOBAL_INITIAL_PAGES) {
    throw new RangeError('globalInitialMemory is below the registry minimum')
  }
  if (scopedInitialPages < ARTIFACT_GLOBAL_INITIAL_PAGES) {
    throw new RangeError('scopedInitialMemory is below the artifact minimum')
  }
  if (
    privateMaximumPages > ARTIFACT_MAXIMUM_PAGES ||
    globalMaximumPages > ARTIFACT_MAXIMUM_PAGES ||
    scopedMaximumPages > ARTIFACT_MAXIMUM_PAGES
  ) {
    throw new RangeError('postmaster memory maximum exceeds the 1 GiB ABI')
  }
  if (
    privateInitialPages > privateMaximumPages ||
    globalInitialPages > globalMaximumPages ||
    scopedInitialPages > scopedMaximumPages
  ) {
    throw new RangeError('postmaster memory initial size exceeds its maximum')
  }
  return {
    privateInitialPages,
    privateMaximumPages,
    globalInitialPages,
    globalMaximumPages,
    scopedInitialPages,
    scopedMaximumPages,
  }
}

function memoryPages(
  bytes: number | undefined,
  fallback: number,
  label: string,
): number {
  if (bytes === undefined) return fallback
  if (!Number.isSafeInteger(bytes) || bytes <= 0) {
    throw new RangeError(`${label} must be a positive integer byte count`)
  }
  return Math.ceil(bytes / WASM_PAGE_BYTES)
}

function createProcessMemory(
  initial = ARTIFACT_PRIVATE_INITIAL_PAGES,
  maximum = ARTIFACT_MAXIMUM_PAGES,
): WebAssembly.Memory {
  return new WebAssembly.Memory({
    initial,
    maximum,
    shared: true,
  })
}

function resolveDataDirectory(value: string): string {
  if (value.startsWith('file:')) return resolve(fileURLToPath(value))
  if (value.includes('://')) {
    throw new Error('The postmaster currently requires a Node file:// VFS')
  }
  return resolve(value)
}

function resolveArtifact(
  artifact: PostmasterArtifactPaths | undefined,
): PostmasterArtifactPaths {
  const resolved = artifact ?? {
    wasm: fileURLToPath(new URL('../postmaster.wasm', import.meta.url)),
    glue: fileURLToPath(new URL('../postmaster.js', import.meta.url)),
    data: fileURLToPath(new URL('../postmaster.data', import.meta.url)),
  }
  const result = {
    wasm: resolve(resolved.wasm),
    glue: resolve(resolved.glue),
    data: resolve(resolved.data),
  }
  for (const path of Object.values(result)) {
    if (!existsSync(path))
      throw new Error(`Missing PGlite postmaster artifact: ${path}`)
  }
  return result
}

function postmasterArguments(
  options: PGlitePostmasterOptions,
  maxConnections: number,
): string[] {
  const portabilityConfig = [
    ['shared_memory_type', 'sysv'],
    ['dynamic_shared_memory_type', 'sysv'],
    ['min_dynamic_shared_memory', '0'],
    ['logging_collector', 'off'],
    ['huge_pages', 'off'],
    ['jit', 'off'],
  ]
  const managedConfig = options.respectPostgresqlConfig
    ? []
    : [
        ['shared_buffers', options.sharedBuffers ?? '16MB'],
        ['max_connections', String(maxConnections)],
        ['listen_addresses', '127.0.0.1'],
        ['unix_socket_directories', ''],
      ]
  const config = [...portabilityConfig, ...managedConfig]
  return [
    '-D',
    '/pglite/data',
    ...config.flatMap(([name, value]) => ['-c', `${name}=${value}`]),
    ...(options.startParams ?? []),
  ]
}

function assertNodeCapabilities(): void {
  const major = Number.parseInt(process.versions.node.split('.')[0], 10)
  if (major < 22) throw new Error('PGlitePostmaster requires Node 22 or newer')
  if (
    typeof (Atomics as typeof Atomics & { waitAsync?: unknown }).waitAsync !==
    'function'
  ) {
    throw new Error('PGlitePostmaster requires Atomics.waitAsync')
  }
  // Keep this explicit: a non-shared private memory would permit accidental
  // construction but fail as soon as the transformed module instantiates.
  const probe = createProcessMemory()
  if (!(probe.buffer instanceof SharedArrayBuffer)) {
    throw new Error('PGlitePostmaster requires shared WebAssembly.Memory')
  }
}
