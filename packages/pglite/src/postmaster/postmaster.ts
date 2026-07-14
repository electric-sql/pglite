import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { Worker } from 'node:worker_threads'
import type { Filesystem } from '../fs/base.js'
import { PGlite } from '../pglite.js'
import { ConnectionTransport } from './connection.js'
import {
  PGLITE_SIGNALS,
  PostgresProcessKind,
  ProcessControlRegistry,
  ProcessExitKind,
  ProcessState,
  VirtualConnectionTransport,
  type ProcessHandle,
  type SpawnRequest,
} from './control.js'
import { SupervisorTimers } from './timers.js'
import { VirtualConnectionBroker } from './virtual-listener.js'
import {
  PGlitePostmasterSession,
  type PGlitePostmasterSessionOptions,
} from './session.js'
import type {
  PostgresProcessWorkerData,
  PostgresProcessWorkerMessage,
  PostmasterArtifactPaths,
  WorkerFilesystemDescriptor,
  WorkerFilesystemFactory,
} from './worker-types.js'

const WASM_PAGE_BYTES = 65_536
const ARTIFACT_PRIVATE_INITIAL_PAGES = 512
const ARTIFACT_GLOBAL_INITIAL_PAGES = 2
const ARTIFACT_MAXIMUM_PAGES = 16_384
const GLOBAL_SHM_ALLOCATION_GENERATION_WORD = (0x1_0000 >>> 2) + 5
const PGLITE_PROCESS_USER_ID = 123
const ownedDirectories = new Set<string>()

export interface ProtocolPeerInfo {
  readonly transport: 'tcp' | 'unix'
  readonly remoteAddress?: string
  readonly remotePort?: number
}

export interface PGliteProtocolConnection {
  readonly readable: AsyncIterable<Uint8Array>
  readonly closed: Promise<void>
  write(data: Uint8Array): Promise<void>
  end(): Promise<void>
  abort(reason?: unknown): void
}

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
  /** Existing PGlite filesystem used by the supervisor-owned initializer. */
  readonly fs?: Filesystem
  /** Existing PGlite ICU data tarball used while initializing PGDATA. */
  readonly icuDataDir?: Blob | File
  /** Creates an ordinary PGlite filesystem locally in every process Worker. */
  readonly workerFilesystem?: WorkerFilesystemFactory
  readonly privateInitialMemory?: number
  readonly privateMaximumMemory?: number
  readonly globalInitialMemory?: number
  readonly globalMaximumMemory?: number
  /** OS identity presented to PostgreSQL for local-socket peer authentication. */
  readonly osUser?: string
  /**
   * Synthetic PID assigned to the postmaster. Test providers can set this to
   * the foreground host wrapper PID so postmaster.pid retains its usual
   * top-level process meaning.
   */
  readonly postmasterPid?: number
}

export type PGlitePostmasterShutdownMode = 'smart' | 'fast' | 'immediate'

export interface PGlitePostmasterExit {
  readonly exitKind: ProcessExitKind
  readonly exitCode: number
}

export interface PGlitePostmasterDiagnostics {
  readonly liveProcesses: number
  readonly livePrivateMemories: number
  readonly privateMemoriesStarted: number
  readonly privateMemoriesReleased: number
  readonly privateMemoryBytes: number
  readonly globalMemoryBytes: number
  readonly privateMemoryMaximumBytes: number
  readonly globalMemoryMaximumBytes: number
  readonly globalShmAllocationGeneration: number
}

interface WorkerRecord {
  readonly handle: ProcessHandle
  readonly worker: Worker
  readonly privateMemoryBytes: number
  readonly connectionId: number
  reportedExitCode?: number
  reportedExitKind?: ProcessExitKind
  settled: boolean
}

export class PGlitePostmaster {
  readonly dataDir: string
  readonly maxConnections: number
  readonly globalMemory: WebAssembly.Memory
  readonly registry: ProcessControlRegistry

  private readonly artifact: PostmasterArtifactPaths
  private readonly wasmModule: WebAssembly.Module
  private readonly workerUrl: URL
  private readonly filesystem: WorkerFilesystemDescriptor
  private readonly privateInitialPages: number
  private readonly privateMaximumPages: number
  private readonly globalMaximumPages: number
  private readonly osUser: string
  private readonly debug: boolean
  private readonly postmasterProcess: ProcessHandle
  private readonly broker: VirtualConnectionBroker
  private readonly timers: SupervisorTimers
  private readonly workers = new Map<number, WorkerRecord>()
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

  private constructor(
    options: PGlitePostmasterOptions,
    dataDir: string,
    artifact: PostmasterArtifactPaths,
    wasmModule: WebAssembly.Module,
    filesystem: WorkerFilesystemDescriptor,
  ) {
    this.dataDir = dataDir
    this.maxConnections = options.maxConnections ?? 20
    this.artifact = artifact
    this.wasmModule = wasmModule
    this.filesystem = filesystem
    const memory = resolveMemoryOptions(options)
    this.privateInitialPages = memory.privateInitialPages
    this.privateMaximumPages = memory.privateMaximumPages
    this.globalMaximumPages = memory.globalMaximumPages
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
  }

  static async create(
    options: PGlitePostmasterOptions,
  ): Promise<PGlitePostmaster> {
    assertNodeCapabilities()
    const dataDir = resolveDataDirectory(options.dataDir)
    if (ownedDirectories.has(dataDir)) {
      throw new Error(`PGlite data directory is already open: ${dataDir}`)
    }
    ownedDirectories.add(dataDir)
    try {
      mkdirSync(dataDir, { recursive: true })
      if (
        options.initialize !== false &&
        (options.fs !== undefined ||
          !existsSync(resolve(dataDir, 'PG_VERSION')))
      ) {
        const initializer = await PGlite.create({
          dataDir: `file://${dataDir}`,
          fs: options.fs,
          icuDataDir: options.icuDataDir,
          debug: options.debug ? 1 : 0,
        })
        await initializer.close()
      }
      if (!options.fs && !existsSync(resolve(dataDir, 'PG_VERSION'))) {
        throw new Error(`PGlite data directory is not initialized: ${dataDir}`)
      }
      if (!options.fs && existsSync(resolve(dataDir, 'postmaster.pid'))) {
        throw new Error(
          `PGlite data directory appears to be in use: ${dataDir}`,
        )
      }

      const artifact = resolveArtifact(options.artifact)
      const wasmModule = await WebAssembly.compile(readFileSync(artifact.wasm))
      const filesystem = resolveWorkerFilesystem(options, dataDir)
      const postmaster = new PGlitePostmaster(
        options,
        dataDir,
        artifact,
        wasmModule,
        filesystem,
      )
      await postmaster.start(options)
      return postmaster
    } catch (error) {
      ownedDirectories.delete(dataDir)
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
    return {
      liveProcesses: live.length,
      livePrivateMemories: live.length,
      privateMemoriesStarted: this.privateMemoriesStarted,
      privateMemoriesReleased: this.privateMemoriesReleased,
      privateMemoryBytes: live.reduce(
        (total, record) => total + record.privateMemoryBytes,
        0,
      ),
      globalMemoryBytes: this.globalMemory.buffer.byteLength,
      privateMemoryMaximumBytes: this.privateMaximumPages * WASM_PAGE_BYTES,
      globalMemoryMaximumBytes: this.globalMaximumPages * WASM_PAGE_BYTES,
      globalShmAllocationGeneration: Atomics.load(
        new Uint32Array(this.globalMemory.buffer),
        GLOBAL_SHM_ALLOCATION_GENERATION_WORD,
      ),
    }
  }

  /** @internal Phase-gate fault injection; never a graceful backend stop. */
  async terminateWorkerForTesting(pid: number): Promise<void> {
    this.assertOpen()
    const record = this.workers.get(pid)
    if (!record) throw new Error(`PostgreSQL Worker ${pid} is not live`)
    const snapshot = this.registry.snapshot(record.handle)
    if (snapshot.kind === PostgresProcessKind.Postmaster) {
      throw new Error('refusing to fault-inject the postmaster Worker')
    }
    await record.worker.terminate()
    this.settleWorker(record, ProcessExitKind.WorkerFailure, 1)
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
    this.broker.close()
    this.closed = true
    this.closing = false
    ownedDirectories.delete(this.dataDir)
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
      await this.startWorker(request.handle, request.connectionId, [
        `--forkchild=${request.childKind}`,
        request.parameterFile,
      ])
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
  ): Promise<void> {
    const workerData: PostgresProcessWorkerData = {
      artifact: this.artifact,
      wasmModule: this.wasmModule,
      privateInitialPages: this.privateInitialPages,
      privateMaximumPages: this.privateMaximumPages,
      globalMemory: this.globalMemory,
      controlBuffer: this.registry.buffer,
      connectionBuffers: this.broker.buffers,
      process: handle,
      inheritedConnectionId: connectionId,
      dataDirectory: this.dataDir,
      filesystem: this.filesystem,
      arguments: args,
      osUser: this.osUser,
      debug: this.debug,
    }
    const worker = new Worker(this.workerUrl, { workerData })
    const record: WorkerRecord = {
      handle,
      worker,
      privateMemoryBytes: this.privateInitialPages * WASM_PAGE_BYTES,
      connectionId,
      settled: false,
    }
    this.privateMemoriesStarted++
    this.workers.set(handle.pid, record)

    await new Promise<void>((resolveReady, rejectReady) => {
      let ready = false
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
        if (message.type === 'runtime-ready') {
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
    this.privateMemoriesReleased++
    if (exitKind === ProcessExitKind.WorkerFailure && record.connectionId) {
      this.broker.abort(record.connectionId, 1)
    }
    this.registry.markExit(record.handle, exitKind, exitCode)
    if (record.handle.pid === this.postmasterProcess.pid) {
      this.resolvePostmasterExit({ exitKind, exitCode })
    }
    record.worker.removeAllListeners()
  }

  private assertOpen(): void {
    if (this.closing || this.closed)
      throw new Error('PGlite postmaster is closed')
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
): WorkerFilesystemDescriptor {
  if (!options.workerFilesystem) {
    if (options.fs) {
      throw new Error(
        'A custom postmaster fs requires a workerFilesystem factory',
      )
    }
    return { kind: 'nodefs', root: dataDir }
  }
  const factory = options.workerFilesystem
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
    kind: 'factory',
    factory: { ...factory, module },
  }
}

interface ResolvedMemoryOptions {
  privateInitialPages: number
  privateMaximumPages: number
  globalInitialPages: number
  globalMaximumPages: number
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
  if (privateInitialPages < ARTIFACT_PRIVATE_INITIAL_PAGES) {
    throw new RangeError('privateInitialMemory is below the artifact minimum')
  }
  if (globalInitialPages < ARTIFACT_GLOBAL_INITIAL_PAGES) {
    throw new RangeError('globalInitialMemory is below the registry minimum')
  }
  if (
    privateMaximumPages > ARTIFACT_MAXIMUM_PAGES ||
    globalMaximumPages > ARTIFACT_MAXIMUM_PAGES
  ) {
    throw new RangeError('postmaster memory maximum exceeds the 1 GiB ABI')
  }
  if (
    privateInitialPages > privateMaximumPages ||
    globalInitialPages > globalMaximumPages
  ) {
    throw new RangeError('postmaster memory initial size exceeds its maximum')
  }
  return {
    privateInitialPages,
    privateMaximumPages,
    globalInitialPages,
    globalMaximumPages,
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
    throw new Error('The postmaster POC currently requires a Node file:// VFS')
  }
  return resolve(value)
}

function resolveArtifact(
  artifact: PostmasterArtifactPaths | undefined,
): PostmasterArtifactPaths {
  const resolved = artifact ?? {
    wasm: fileURLToPath(
      new URL('../../release/postmaster.wasm', import.meta.url),
    ),
    glue: fileURLToPath(
      new URL('../../release/postmaster.js', import.meta.url),
    ),
    data: fileURLToPath(
      new URL('../../release/postmaster.data', import.meta.url),
    ),
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
    ['io_method', 'sync'],
    ['jit', 'off'],
  ]
  const managedConfig = options.respectPostgresqlConfig
    ? []
    : [
        ['shared_buffers', options.sharedBuffers ?? '16MB'],
        ['max_connections', String(maxConnections)],
        ['listen_addresses', '127.0.0.1'],
        ['unix_socket_directories', ''],
        ['max_parallel_workers', '0'],
        ['max_parallel_workers_per_gather', '0'],
        ['max_parallel_maintenance_workers', '0'],
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
