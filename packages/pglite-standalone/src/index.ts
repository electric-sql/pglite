import { readFile } from 'node:fs/promises'
import { Instance } from './instance.js'
import { PGDATA, defaultEnv, defaultStartParams } from './defaults.js'

export { PGDATA, defaultEnv, defaultStartParams } from './defaults.js'
export { initdb, defaultInitdbArgs, type InitdbOptions } from './initdb.js'

/**
 * Reference host for the standalone PGlite WASM module, on node:wasi. It mirrors
 * the startup sequence and execProtocolRawSync() of the PGlite class. Needs
 * Node 22+ with --experimental-wasm-exnref.
 */

const PGLITE_EXIT_ALIVE = 99
const POSTGRES_MAIN_LONGJMP = 100
// what the pgl_* host entry points return when the call returned instead of exiting
const RETURNED = -1

export interface StandaloneOptions {
  /** The compiled standalone module (pglite-standalone.wasm) */
  module: WebAssembly.Module
  /** Tarballs (optionally gzipped) to unpack at "/", e.g. pglite-standalone-fs.tar.gz */
  fs: Uint8Array[]
  /** Tarball holding the contents of an initialized PGDATA, from initdb() or PGlite.dumpDataDir() */
  dataDir?: Uint8Array
  startParams?: string[]
  env?: Record<string, string>
}

interface Exports {
  malloc(size: number): number
  free(ptr: number): void
  pgl_setPGliteActive(value: number): number
  pgl_loop_once(): number
  pgl_longjmp_recover(): number
  pgl_startPGlite(): void
  pgl_getMyProcPort(): number
  pgl_sendConnData(): void
  pgl_pq_flush(): void
  ProcessStartupPacket(port: number, cancelReq: number): number
  PostgresSendReadyForQueryIfNecessary(): void
  pq_buffer_remaining_data(): number
}

export async function loadModule(path: string): Promise<WebAssembly.Module> {
  return WebAssembly.compile(await readFile(path))
}

export class StandalonePGlite {
  #pg: Instance
  #ex: Exports
  #input = new Uint8Array(0)
  #readOffset = 0
  #output: Uint8Array[] = []

  private constructor(opts: StandaloneOptions) {
    const env = { ...defaultEnv, ...opts.env }
    this.#pg = new Instance(opts.module, {
      env,
      read: (ptr, max) => this.#hostRead(ptr, max),
      write: (ptr, len) => this.#hostWrite(ptr, len),
    })
    this.#ex = this.#pg.exports as unknown as Exports
    for (const tarball of opts.fs) this.#pg.loadTar(tarball, '/')
    if (opts.dataDir) this.#pg.loadTar(opts.dataDir, PGDATA)
    this.#start(opts.startParams ?? defaultStartParams, env.PGDATABASE)
  }

  static async create(opts: StandaloneOptions): Promise<StandalonePGlite> {
    return new StandalonePGlite(opts)
  }

  #hostRead(ptr: number, max: number): number {
    const chunk = this.#input.subarray(this.#readOffset, this.#readOffset + max)
    this.#pg.heap.set(chunk, ptr)
    this.#readOffset += chunk.length
    return chunk.length
  }

  #hostWrite(ptr: number, len: number): number {
    this.#output.push(this.#pg.heap.slice(ptr, ptr + len))
    return len
  }

  #start(startParams: string[], database: string) {
    this.#ex.pgl_setPGliteActive(1)
    const status = this.#pg.callMain([
      '/pglite/bin/postgres',
      ...startParams,
      '-D',
      PGDATA,
      database,
    ])
    if (status !== PGLITE_EXIT_ALIVE) {
      throw new Error(`PGlite failed to initialize properly (${status})`)
    }
    this.#ex.pgl_startPGlite()
  }

  /**
   * Execute one or more complete frontend protocol messages and return the
   * backend's response, like PGlite.execProtocolRawSync().
   */
  execProtocolRaw(message: Uint8Array): Uint8Array {
    const ex = this.#ex
    this.#input = message
    this.#readOffset = 0
    this.#output = []

    if (message[0] === 'X'.charCodeAt(0)) return new Uint8Array(0)

    if (message[0] === 0) {
      // startup packet; cancelReq is room for a CancelRequest, which we ignore
      const cancelReq = this.#pg.alloc(new Uint8Array(512))
      try {
        if (ex.ProcessStartupPacket(ex.pgl_getMyProcPort(), cancelReq) !== 0) {
          throw new Error('Cannot process startup packet')
        }
      } finally {
        ex.free(cancelReq)
      }
      ex.pgl_sendConnData()
      ex.pgl_pq_flush()
    } else {
      try {
        while (
          this.#readOffset < message.length ||
          ex.pq_buffer_remaining_data() > 0
        ) {
          const status = ex.pgl_loop_once()
          if (status === POSTGRES_MAIN_LONGJMP) {
            // a top level error longjmp: recover, like PostgresMain's sigsetjmp
            ex.pgl_longjmp_recover()
          } else if (status !== RETURNED) {
            throw new Error(`PGlite exited (${status})`)
          }
        }
      } finally {
        ex.PostgresSendReadyForQueryIfNecessary()
        ex.pgl_pq_flush()
      }
    }

    this.#input = new Uint8Array(0)
    const out = new Uint8Array(this.#output.reduce((n, c) => n + c.length, 0))
    let offset = 0
    for (const chunk of this.#output) {
      out.set(chunk, offset)
      offset += chunk.length
    }
    this.#output = []
    return out
  }
}
