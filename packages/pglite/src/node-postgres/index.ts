import { EventEmitter } from 'events'
import { PGlite } from '../pglite.js'
import type { Extensions, PGliteOptions } from '../interface.js'
import { serialize } from '@electric-sql/pg-protocol'

export interface Config {
  pglite: PGlite
}

/**
 * Create a new PGlitePgConfig instance.
 * This object can then be used with node-postgres clients such as Pool,
 * e.g.:
 * const pgConfig = createPgConfig()
 * const pool = new Pool(pgConfig)
 * const client = await pool.connect()
 *
 * @param pglite An existing PGlite instance to use instead of creating a new
 *               one. It is owned by the caller and is not closed by node-postgres.
 * @param dataDir The directory to store the database files
 *                Use memory:// to use in-memory filesystem
 * @param options PGlite options
 * @returns The PGlitePgConfig instance. node-postgres waits for PGlite to be
 *          ready when connecting.
 */
export function createPgConfig(pglite: PGlite): PGlitePgConfig

export function createPgConfig<O extends PGliteOptions>(
  options?: O,
): PGlitePgConfig

export function createPgConfig<O extends PGliteOptions>(
  dataDir?: string,
  options?: O,
): PGlitePgConfig

export function createPgConfig<TExtensions extends Extensions = Extensions>(
  pgliteOrDataDirOrPGliteOptions?: PGlite | string | PGliteOptions<TExtensions>,
  options?: PGliteOptions<TExtensions>,
): PGlitePgConfig {
  if (isPGlite(pgliteOrDataDirOrPGliteOptions)) {
    return new PGlitePgConfig({ pglite: pgliteOrDataDirOrPGliteOptions })
  }

  const resolvedOpts: PGliteOptions =
    typeof pgliteOrDataDirOrPGliteOptions === 'string'
      ? {
          dataDir: pgliteOrDataDirOrPGliteOptions,
          ...(options ?? {}),
        }
      : (pgliteOrDataDirOrPGliteOptions ?? options ?? {})

  const pglite = new PGlite(resolvedOpts)
  return new PGlitePgConfig({ pglite })
}

// duck-typed rather than instanceof: the CJS build of this entry bundles its
// own copy of the PGlite class, distinct from the one in the main entry
function isPGlite(value: unknown): value is PGlite {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as PGlite).execProtocolStream === 'function'
  )
}

export class PGlitePgConfig {
  constructor(config: Config) {
    this.connection = new PglitePgConnection({ pglite: config.pglite })
  }

  public readonly connection: PglitePgConnection
  public readonly poolSize = 1 // PGlite is single connection at the moment
  public readonly password = 'dummy' // PGlite accepts any password
  public readonly user = 'postgres' // dummy
  public readonly database = 'postgres' // dummy
  public readonly port = 5432 // dummy
  public readonly host = 'localhost' // dummy
}

export class PglitePgConnection extends EventEmitter {
  #pglite: PGlite
  #emitMessage: boolean = false
  #queue: Promise<void>

  // checked by pg's Client.end(), which skips connection.end() without it
  public _connecting = false

  // pg's Client.end() destroys the stream when a query is still active
  public readonly stream = { destroy: () => this.end() }

  #send(buffer: any) {
    this.#queue = this.#queue
      .then(() =>
        this.#pglite.execProtocolStream(buffer, { throwOnError: false }),
      )
      .then((messages) => {
        messages.forEach((m) => {
          if (this.#emitMessage) {
            this.emit('message', m)
          }
          // node-postgres expects ErrorResponse as 'errorMessage'
          this.emit(m.name === 'error' ? 'errorMessage' : m.name, m)
        })
      })
      .catch((err) => {
        this.emit('error', err)
      })
  }

  public parsedStatements = {}
  public submittedNamedStatements = {}

  constructor(config: Config) {
    super()
    this.#pglite = config.pglite

    this.on('newListener', (eventName) => {
      if (eventName === 'message') {
        this.#emitMessage = true
      }
    })

    this.#queue = config.pglite.waitReady
  }

  async connect(_port: number, _host: string) {
    this._connecting = true
    await this.#pglite.waitReady
    process.nextTick(() => this.emit('readyForQuery'))
  }

  requestSsl() {
    // dummy
  }

  startup(_config: any) {
    // dummy
  }

  cancel(_processID: any, _secretKey: any) {
    // dummy
  }

  password(_password: string) {
    // dummy
  }

  sendSASLInitialResponseMessage(mechanism: any, initialResponse: any) {
    this.#send(
      serialize.sendSASLInitialResponseMessage(mechanism, initialResponse),
    )
  }

  sendSCRAMClientFinalMessage(additionalData: any) {
    this.#send(serialize.sendSCRAMClientFinalMessage(additionalData))
  }

  query(text: string) {
    this.#send(serialize.query(text))
  }

  parse(query: any) {
    // throw new Error('Not implemented')
    this.#send(serialize.parse(query))
  }

  bind(config: any) {
    this.#send(serialize.bind(config))
  }

  execute(config: any) {
    this.#send(serialize.execute(config))
  }

  flush() {
    this.#send(serialize.flush())
  }

  sync() {
    this.#send(serialize.sync())
  }

  end() {
    // like a socket closing: pg waits for 'end'. The PGlite instance is
    // shared and owned by the caller, so it stays open.
    this.#queue = this.#queue.then(() => {
      this.emit('end')
    })
    // the pool reuses this connection for its next client: drop the
    // ended client's listeners so they don't receive its messages
    this.eventNames()
      .filter((e) => e !== 'newListener')
      .forEach((e) => this.removeAllListeners(e))
    this.#emitMessage = false
  }

  close(msg: any) {
    this.#send(serialize.close(msg))
  }

  describe(msg: any) {
    this.#send(serialize.describe(msg))
  }

  sendCopyFromChunk(chunk: any) {
    this.#send(serialize.copyData(chunk))
  }

  endCopyFrom() {
    this.#send(serialize.copyDone())
  }

  sendCopyFail(msg: any) {
    this.#send(serialize.copyFail(msg))
  }

  ref() {
    // dummy
  }

  unref() {
    // dummy
  }
}
