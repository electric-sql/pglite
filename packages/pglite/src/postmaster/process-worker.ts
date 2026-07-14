import { readFileSync } from 'node:fs'
import { parentPort, workerData } from 'node:worker_threads'
import { pathToFileURL } from 'node:url'
import type { Filesystem } from '../fs/base.js'
import type { PGlite } from '../pglite.js'
import type { PostgresMod } from '../postgresMod.js'
import { PgliteMemoryViews } from '../wasm/multi-memory.js'
import {
  ProcessControlRegistry,
  ProcessScopePolicy,
  ProcessState,
} from './control.js'
import { PostmasterProcessHost } from './process-host.js'
import { VirtualSocketHost } from './socket-host.js'
import {
  installMemoryAwareWasiFdRead,
  installMemoryAwareWasiFdWrite,
} from './wasi-host.js'
import type {
  PostgresProcessWorkerData,
  PostgresProcessWorkerMessage,
} from './worker-types.js'

async function main(): Promise<void> {
  const data = workerData as PostgresProcessWorkerData
  const port = parentPort
  if (!port) throw new Error('PostgreSQL process Worker has no parent port')

  const send = (message: PostgresProcessWorkerMessage) =>
    port.postMessage(message)
  const debug = (text: string) => {
    if (data.debug) send({ type: 'stdout', pid: data.process.pid, text })
  }

  let processHost: PostmasterProcessHost | undefined
  let socketHost: VirtualSocketHost | undefined
  let postgres: PostgresMod | undefined
  let filesystem: Filesystem | undefined
  let exitCode: number | undefined
  let fatalError: unknown

  try {
    // The private memory must be owned by this Worker isolate. Creating it in
    // the supervisor leaves its SharedArrayBuffer backing store subject to
    // main-isolate GC after backend exit, which makes reconnect churn retain
    // many already-dead backend heaps. Worker-owned memory is released with
    // the isolate when the Worker terminates.
    const privateMemory = new WebAssembly.Memory({
      initial: data.privateInitialPages,
      maximum: data.privateMaximumPages,
      shared: true,
    })
    let scopedMemory: WebAssembly.Memory
    if (data.scopePolicy === ProcessScopePolicy.SelfAlias) {
      if (
        data.scopeRoot ||
        data.scopedMemory ||
        data.scopedMemoryMode !== 'disabled'
      ) {
        throw new Error('SelfAlias Worker received a scoped root binding')
      }
      scopedMemory = privateMemory
    } else if (data.scopePolicy === ProcessScopePolicy.NewRoot) {
      if (
        !data.scopeRoot ||
        data.scopeRoot.pid !== data.process.pid ||
        data.scopeRoot.generation !== data.process.generation ||
        data.scopedMemory ||
        data.scopedMemoryMode === 'disabled'
      ) {
        throw new Error('NewRoot Worker received an invalid root binding')
      }
      scopedMemory =
        data.scopedMemoryMode === 'compact'
          ? privateMemory
          : new WebAssembly.Memory({
              initial: data.scopedInitialPages,
              maximum: data.scopedMaximumPages,
              shared: true,
            })
    } else {
      if (
        !data.scopeRoot ||
        !data.scopedMemory ||
        data.scopedMemoryMode === 'disabled'
      ) {
        throw new Error('inherited Worker has no scoped root memory')
      }
      scopedMemory = data.scopedMemory
    }
    debug('loading process artifact')
    const registry = ProcessControlRegistry.attach(data.controlBuffer)
    const packageBytes = readFileSync(data.artifact.data)
    const { default: createPostgres } = (await import(
      pathToFileURL(data.artifact.glue).href
    )) as {
      default: (options: Partial<PostgresMod>) => Promise<PostgresMod>
    }
    let filesystemOptions: Partial<PostgresMod> = {}
    if (data.filesystem.kind === 'factory') {
      const namespace = (await import(
        data.filesystem.factory.module
      )) as Record<string, unknown>
      const exported = namespace[data.filesystem.factory.export ?? 'default']
      if (typeof exported !== 'function') {
        throw new TypeError(
          `Worker filesystem export ${data.filesystem.factory.export ?? 'default'} is not a factory function`,
        )
      }
      filesystem = await (
        exported as (options: unknown) => Filesystem | Promise<Filesystem>
      )(data.filesystem.factory.options)
      if (!filesystem || typeof filesystem.init !== 'function') {
        throw new TypeError(
          'Worker filesystem factory did not return a PGlite Filesystem',
        )
      }
      const facade = {
        dataDir: data.dataDirectory,
        debug: data.debug ? 1 : 0,
        get Module() {
          if (!postgres) {
            throw new Error(
              'Worker filesystem accessed PGlite.Module before preRun',
            )
          }
          return postgres
        },
      } as unknown as PGlite
      filesystemOptions = (await filesystem.init(facade, {})).emscriptenOpts
      assertFilesystemOptions(filesystemOptions)
    }
    const memories = new PgliteMemoryViews({
      private: privateMemory,
      global: data.globalMemory,
      scoped: scopedMemory,
    })

    debug('initializing Emscripten runtime')
    const filesystemPreRun = filesystemOptions.preRun ?? []
    const nodeFilesystemPreRun: Array<(module: PostgresMod) => void> = []
    if (data.filesystem.kind === 'nodefs') {
      const root = data.filesystem.root
      nodeFilesystemPreRun.push((module: PostgresMod) => {
        debug('mounting Worker NODEFS data directory')
        const fs = module.FS as typeof module.FS & {
          mkdirTree(path: string): void
        }
        fs.mkdirTree('/pglite/data')
        fs.mount(fs.filesystems.NODEFS, { root }, '/pglite/data')
      })
    }
    postgres = await createPostgres({
      ...filesystemOptions,
      thisProgram: '/pglite/bin/postgres',
      arguments: [...data.arguments],
      noInitialRun: true,
      noExitRuntime: true,
      wasmMemory: privateMemory,
      stdin: () => null,
      print: (text: string) => {
        if (data.debug) send({ type: 'stdout', pid: data.process.pid, text })
      },
      printErr: (text: string) => {
        send({ type: 'stderr', pid: data.process.pid, text })
      },
      getPreloadedPackage: () =>
        packageBytes.buffer.slice(
          packageBytes.byteOffset,
          packageBytes.byteOffset + packageBytes.byteLength,
        ) as ArrayBuffer,
      instantiateWasm(imports, success) {
        imports.pglite = {
          ...(imports.pglite ?? {}),
          global_memory: data.globalMemory,
          scoped_memory: scopedMemory,
        }
        installMemoryAwareWasiFdRead(imports, memories, () => postgres?.FS)
        installMemoryAwareWasiFdWrite(imports, memories, () => postgres?.FS)
        WebAssembly.instantiate(data.wasmModule, imports).then((instance) =>
          (
            success as (
              instance: WebAssembly.Instance,
              module: WebAssembly.Module,
            ) => void
          )(instance, data.wasmModule),
        )
        return {}
      },
      // Emscripten registers Module.preRun entries with unshift(), so it
      // executes this array from right to left. Keep the dependencies in
      // execution order as: environment, filesystem mount, then chdir.
      preRun: [
        (module: PostgresMod) => {
          const fs = module.FS as typeof module.FS & {
            mkdirTree(path: string): void
          }
          // EXEC_BACKEND inherits the postmaster's working directory on a
          // native host. Each Worker starts with Emscripten's default `/`, so
          // restore that inherited state before PostgreSQL consumes the
          // relative backend-variable file path passed by the postmaster.
          fs.chdir('/pglite/data')
          debug('Worker filesystem ready')
        },
        ...nodeFilesystemPreRun,
        ...filesystemPreRun,
        (module: PostgresMod) => {
          module.ENV.PGDATA = '/pglite/data'
          module.ENV.HOME = '/home/postgres'
          module.ENV.USER = data.osUser
          module.ENV.LOGNAME = data.osUser
          module.ENV.ICU_DATA = '/pglite/icu'
        },
      ],
    })

    debug('installing process hosts')
    socketHost = new VirtualSocketHost({
      module: postgres,
      registry,
      process: data.process,
      postmaster: data.postmaster,
      privateMemory,
      connectionBuffers: data.connectionBuffers,
      inheritedConnectionId: data.inheritedConnectionId || undefined,
      debug: data.debug,
    })
    socketHost.install()
    processHost = new PostmasterProcessHost({
      module: postgres,
      registry,
      process: data.process,
      privateMemory,
      globalMemory: data.globalMemory,
      scopedMemory,
      scopedMemoryMode: data.scopedMemoryMode,
      debug: data.debug,
      connectionIdForDescriptor: (descriptor) =>
        socketHost!.connectionIdForDescriptor(descriptor),
    })
    processHost.install()

    if (data.scopePolicy === ProcessScopePolicy.NewRoot) {
      if (!data.scopeRoot || postgres._pgl_shm_scope_root() === 0n) {
        throw new Error('could not initialize the Worker scoped-memory root')
      }
      const registryOffset = postgres._pgl_shm_registry_offset() >>> 0
      if (registryOffset === 0) {
        throw new Error('Worker scoped-memory registry has no address')
      }
      send({
        type: 'scoped-memory-ready',
        pid: data.process.pid,
        root: data.scopeRoot,
        memory: scopedMemory,
        mode: data.scopedMemoryMode as 'dedicated' | 'compact',
        registryOffset,
      })
    }

    registry.transition(data.process, ProcessState.Runnable)
    send({ type: 'runtime-ready', pid: data.process.pid })
    exitCode = 0
    try {
      exitCode = postgres.callMain([...data.arguments])
    } catch (error) {
      const status = (error as { status?: unknown }).status
      if (typeof status === 'number') exitCode = status
      else throw error
    }
  } catch (error) {
    fatalError = error
    process.exitCode = 1
  } finally {
    processHost?.dispose()
    socketHost?.dispose()
    try {
      if (filesystem) await filesystem.closeFs()
      else postgres?.FS.quit()
    } catch {
      // The Emscripten runtime may already have performed its exit cleanup.
    }
    if (fatalError !== undefined) {
      send({
        type: 'fatal',
        pid: data.process.pid,
        error: formatWorkerError(fatalError),
      })
    } else {
      send({ type: 'exit', pid: data.process.pid, code: exitCode ?? 1 })
    }
    port.close()
  }
}

function formatWorkerError(error: unknown): string {
  if (error instanceof Error) return error.stack || error.message
  if (typeof error !== 'object' || error === null) return String(error)
  const record = error as Record<string, unknown>
  const fields = ['name', 'message', 'errno', 'code', 'path']
    .filter((key) => record[key] !== undefined)
    .map((key) => `${key}=${String(record[key])}`)
  return fields.length > 0 ? fields.join(' ') : String(error)
}

function assertFilesystemOptions(options: Partial<PostgresMod>): void {
  for (const key of [
    'arguments',
    'instantiateWasm',
    'noInitialRun',
    'thisProgram',
    'wasmMemory',
  ] as const) {
    if (key in options) {
      throw new Error(
        `Worker filesystem may not override Emscripten option ${key}`,
      )
    }
  }
}

void main()
