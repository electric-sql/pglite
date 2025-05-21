import { Mutex } from 'async-mutex'
import { BasePGlite } from './base.js'
import { loadExtensionBundle, loadExtensions } from './extensionUtils.js'
import {
  type Filesystem,
  loadFs,
  parseDataDir,
  PGDATA,
  WASM_PREFIX,
} from './fs/index.js'
import { DumpTarCompressionOptions, loadTar } from './fs/tarUtils.js'
import type {
  DebugLevel,
  ExecProtocolOptions,
  ExecProtocolResult,
  Extensions,
  PGliteInterface,
  PGliteInterfaceExtensions,
  PGliteOptions,
  DataTransferContainer,
} from './interface.js'
import PostgresModFactory, { type PostgresMod } from './postgresMod.js'
import {
  getFsBundle,
  instantiateWasm,
  startWasmDownload,
  toPostgresName,
} from './utils.js'

// Importing the source as the built version is not ESM compatible
import { Parser as ProtocolParser, serialize } from '@electric-sql/pg-protocol'
import {
  BackendMessage,
  CommandCompleteMessage,
  DatabaseError,
  NoticeMessage,
  NotificationResponseMessage,
} from '@electric-sql/pg-protocol/messages'

export class PGlite
  extends BasePGlite
  implements PGliteInterface, AsyncDisposable
{
  fs?: Filesystem
  protected mod?: PostgresMod

  readonly dataDir?: string

  #ready = false
  #closing = false
  #closed = false
  #inTransaction = false
  #relaxedDurability = false

  readonly waitReady: Promise<void>

  #queryMutex = new Mutex()
  #transactionMutex = new Mutex()
  #listenMutex = new Mutex()
  #fsSyncMutex = new Mutex()
  #fsSyncScheduled = false

  #dataTransferContainer: DataTransferContainer = 'cma'

  readonly debug: DebugLevel = 0

  #extensions: Extensions
  #extensionsClose: Array<() => Promise<void>> = []

  #protocolParser = new ProtocolParser()

  // These are the current ArrayBuffer that is being read or written to
  // during a query, such as COPY FROM or COPY TO.
  #queryReadBuffer?: ArrayBuffer
  #queryWriteChunks?: Uint8Array[]

  #notifyListeners = new Map<string, Set<(payload: string) => void>>()
  #globalNotifyListeners = new Set<(channel: string, payload: string) => void>()

  /**
   * Create a new PGlite instance
   * @param dataDir The directory to store the database files
   *                Prefix with idb:// to use indexeddb filesystem in the browser
   *                Use memory:// to use in-memory filesystem
   * @param options PGlite options
   */
  constructor(dataDir?: string, options?: PGliteOptions)

  /**
   * Create a new PGlite instance
   * @param options PGlite options including the data directory
   */
  constructor(options?: PGliteOptions)

  constructor(
    dataDirOrPGliteOptions: string | PGliteOptions = {},
    options: PGliteOptions = {},
  ) {
    super()
    if (typeof dataDirOrPGliteOptions === 'string') {
      options = {
        dataDir: dataDirOrPGliteOptions,
        ...options,
      }
    } else {
      options = dataDirOrPGliteOptions
    }
    this.dataDir = options.dataDir

    // Override default parsers and serializers if requested
    if (options.parsers !== undefined) {
      this.parsers = { ...this.parsers, ...options.parsers }
    }
    if (options.serializers !== undefined) {
      this.serializers = { ...this.serializers, ...options.serializers }
    }

    // Enable debug logging if requested
    if (options?.debug !== undefined) {
      this.debug = options.debug
    }

    // Enable relaxed durability if requested
    if (options?.relaxedDurability !== undefined) {
      this.#relaxedDurability = options.relaxedDurability
    }

    // Set the default data transfer container
    if (options?.defaultDataTransferContainer !== undefined) {
      this.#dataTransferContainer = options.defaultDataTransferContainer
    }

    // Save the extensions for later use
    this.#extensions = options.extensions ?? {}

    // Initialize the database, and store the promise so we can wait for it to be ready
    this.waitReady = this.#init(options ?? {})
  }

  /**
   * Create a new PGlite instance with extensions on the Typescript interface
   * (The main constructor does enable extensions, however due to the limitations
   * of Typescript, the extensions are not available on the instance interface)
   * @param options PGlite options including the data directory
   * @returns A promise that resolves to the PGlite instance when it's ready.
   */

  static async create<O extends PGliteOptions>(
    options?: O,
  ): Promise<PGlite & PGliteInterfaceExtensions<O['extensions']>>

  /**
   * Create a new PGlite instance with extensions on the Typescript interface
   * (The main constructor does enable extensions, however due to the limitations
   * of Typescript, the extensions are not available on the instance interface)
   * @param dataDir The directory to store the database files
   *                Prefix with idb:// to use indexeddb filesystem in the browser
   *                Use memory:// to use in-memory filesystem
   * @param options PGlite options
   * @returns A promise that resolves to the PGlite instance when it's ready.
   */
  static async create<O extends PGliteOptions>(
    dataDir?: string,
    options?: O,
  ): Promise<PGlite & PGliteInterfaceExtensions<O['extensions']>>

  static async create<TExtensions extends Extensions = Extensions>(
    dataDirOrPGliteOptions?: string | PGliteOptions<TExtensions>,
    options?: PGliteOptions<TExtensions>,
  ): Promise<PGlite & PGliteInterface<TExtensions>> {
    const resolvedOpts: PGliteOptions =
      typeof dataDirOrPGliteOptions === 'string'
        ? {
            dataDir: dataDirOrPGliteOptions,
            ...(options ?? {}),
          }
        : (dataDirOrPGliteOptions ?? {})

    const pg = new PGlite(resolvedOpts)
    await pg.waitReady
    return pg as any
  }

  /**
   * Initialize the database
   * @returns A promise that resolves when the database is ready
   */
  async #init(options: PGliteOptions) {
    if (options.fs) {
      this.fs = options.fs
    } else {
      const { dataDir, fsType } = parseDataDir(options.dataDir)
      this.fs = await loadFs(dataDir, fsType)
    }

    const extensionBundlePromises: Record<string, Promise<Blob | null>> = {}
    const extensionInitFns: Array<() => Promise<void>> = []

    const args = [
      `PGDATA=${PGDATA}`,
      `PREFIX=${WASM_PREFIX}`,
      `PGUSER=${options.username ?? 'postgres'}`,
      `PGDATABASE=${options.database ?? 'template1'}`,
      'MODE=REACT',
      'REPL=N',
      // "-F", // Disable fsync (TODO: Only for in-memory mode?)
      ...(this.debug ? ['-d', this.debug.toString()] : []),
    ]

    if (!options.wasmModule) {
      // Start the wasm download in the background so it's ready when we need it
      startWasmDownload()
    }

    // Get the fs bundle
    // We don't await the loading of the fs bundle at this point as we can continue
    // with other work.
    // It's resolved value `fsBundleBuffer` is set and used in `getPreloadedPackage`
    // which is called via `PostgresModFactory` after we have awaited
    // `fsBundleBufferPromise` below.
    const fsBundleBufferPromise = options.fsBundle
      ? options.fsBundle.arrayBuffer()
      : getFsBundle()
    let fsBundleBuffer: ArrayBuffer
    fsBundleBufferPromise.then((buffer) => {
      fsBundleBuffer = buffer
    })

    let emscriptenOpts: Partial<PostgresMod> = {
      WASM_PREFIX,
      arguments: args,
      INITIAL_MEMORY: options.initialMemory,
      noExitRuntime: true,
      ...(this.debug > 0
        ? { print: console.info, printErr: console.error }
        : { print: () => {}, printErr: () => {} }),
      instantiateWasm: (imports, successCallback) => {
        instantiateWasm(imports, options.wasmModule).then(
          ({ instance, module }) => {
            // @ts-ignore wrong type in Emscripten typings
            successCallback(instance, module)
          },
        )
        return {}
      },
      getPreloadedPackage: (remotePackageName, remotePackageSize) => {
        if (remotePackageName === 'pglite.data') {
          if (fsBundleBuffer.byteLength !== remotePackageSize) {
            throw new Error(
              `Invalid FS bundle size: ${fsBundleBuffer.byteLength} !== ${remotePackageSize}`,
            )
          }
          return fsBundleBuffer
        }
        throw new Error(`Unknown package: ${remotePackageName}`)
      },
      preRun: [
        (mod: any) => {
          // Register /dev/blob device
          // This is used to read and write blobs when used in COPY TO/FROM
          // e.g. COPY mytable TO '/dev/blob' WITH (FORMAT binary)
          // The data is returned by the query as a `blob` property in the results
          const devId = mod.FS.makedev(64, 0)
          const devOpt = {
            open: (_stream: any) => {},
            close: (_stream: any) => {},
            read: (
              _stream: any,
              buffer: Uint8Array,
              offset: number,
              length: number,
              position: number,
            ) => {
              const buf = this.#queryReadBuffer
              if (!buf) {
                throw new Error(
                  'No /dev/blob File or Blob provided to read from',
                )
              }
              const contents = new Uint8Array(buf)
              if (position >= contents.length) return 0
              const size = Math.min(contents.length - position, length)
              for (let i = 0; i < size; i++) {
                buffer[offset + i] = contents[position + i]
              }
              return size
            },
            write: (
              _stream: any,
              buffer: Uint8Array,
              offset: number,
              length: number,
              _position: number,
            ) => {
              this.#queryWriteChunks ??= []
              this.#queryWriteChunks.push(buffer.slice(offset, offset + length))
              return length
            },
            llseek: (stream: any, offset: number, whence: number) => {
              const buf = this.#queryReadBuffer
              if (!buf) {
                throw new Error('No /dev/blob File or Blob provided to llseek')
              }
              let position = offset
              if (whence === 1) {
                position += stream.position
              } else if (whence === 2) {
                position = new Uint8Array(buf).length
              }
              if (position < 0) {
                throw new mod.FS.ErrnoError(28)
              }
              return position
            },
          }
          mod.FS.registerDevice(devId, devOpt)
          mod.FS.mkdev('/dev/blob', devId)
        },
      ],
    }

    const { emscriptenOpts: amendedEmscriptenOpts } = await this.fs!.init(
      this,
      emscriptenOpts,
    )
    emscriptenOpts = amendedEmscriptenOpts

    // # Setup extensions
    // This is the first step of loading PGlite extensions
    // We loop through each extension and call the setup function
    // This amends the emscriptenOpts and can return:
    // - emscriptenOpts: The updated emscripten options
    // - namespaceObj: The namespace object to attach to the PGlite instance
    // - init: A function to initialize the extension/plugin after the database is ready
    // - close: A function to close/tidy-up the extension/plugin when the database is closed
    for (const [extName, ext] of Object.entries(this.#extensions)) {
      if (ext instanceof URL) {
        // Extension with only a URL to a bundle
        extensionBundlePromises[extName] = loadExtensionBundle(ext)
      } else {
        // Extension with JS setup function
        const extRet = await ext.setup(this, emscriptenOpts)
        if (extRet.emscriptenOpts) {
          emscriptenOpts = extRet.emscriptenOpts
        }
        if (extRet.namespaceObj) {
          const instance = this as any
          instance[extName] = extRet.namespaceObj
        }
        if (extRet.bundlePath) {
          extensionBundlePromises[extName] = loadExtensionBundle(
            extRet.bundlePath,
          ) // Don't await here, this is parallel
        }
        if (extRet.init) {
          extensionInitFns.push(extRet.init)
        }
        if (extRet.close) {
          this.#extensionsClose.push(extRet.close)
        }
      }
    }
    emscriptenOpts['pg_extensions'] = extensionBundlePromises

    // Await the fs bundle - we do this just before calling PostgresModFactory
    // as it needs the fs bundle to be ready.
    await fsBundleBufferPromise

    // Load the database engine
    this.mod = await PostgresModFactory(emscriptenOpts)

    // Sync the filesystem from any previous store
    await this.fs!.initialSyncFs()

    // If the user has provided a tarball to load the database from, do that now.
    // We do this after the initial sync so that we can throw if the database
    // already exists.
    if (options.loadDataDir) {
      if (this.mod.FS.analyzePath(PGDATA + '/PG_VERSION').exists) {
        throw new Error('Database already exists, cannot load from tarball')
      }
      this.#log('pglite: loading data from tarball')
      await loadTar(this.mod.FS, options.loadDataDir, PGDATA)
    }

    // Check and log if the database exists
    if (this.mod.FS.analyzePath(PGDATA + '/PG_VERSION').exists) {
      this.#log('pglite: found DB, resuming')
    } else {
      this.#log('pglite: no db')
    }

    // Start compiling dynamic extensions present in FS.
    await loadExtensions(this.mod, (...args) => this.#log(...args))

    // Initialize the database
    const idb = this.mod._pgl_initdb()

    if (!idb) {
      // This would be a sab worker crash before pg_initdb can be called
      throw new Error('INITDB failed to return value')
    }

    // initdb states:
    // - populating pgdata
    // - reconnect a previous db
    // - found valid db+user
    // currently unhandled:
    // - db does not exist
    // - user is invalid for db

    if (idb & 0b0001) {
      // this would be a wasm crash inside pg_initdb from a sab worker.
      throw new Error('INITDB: failed to execute')
    } else if (idb & 0b0010) {
      // initdb was called to init PGDATA if required
      const pguser = options.username ?? 'postgres'
      const pgdatabase = options.database ?? 'template1'
      if (idb & 0b0100) {
        // initdb has found a previous database
        if (idb & (0b0100 | 0b1000)) {
          // initdb found db+user, and we switched to that user
        } else {
          // TODO: invalid user for db?
          throw new Error(
            `INITDB: Invalid db ${pgdatabase}/user ${pguser} combination`,
          )
        }
      } else {
        // initdb has created a new database for us, we can only continue if we are
        // in template1 and the user is postgres
        if (pgdatabase !== 'template1' && pguser !== 'postgres') {
          // throw new Error(`Invalid database ${pgdatabase} requested`);
          throw new Error(
            `INITDB: created a new datadir ${PGDATA}, but an alternative db ${pgdatabase}/user ${pguser} was requested`,
          )
        }
      }
    }

    // (re)start backed after possible initdb boot/single.
    this.mod._pgl_backend()

    // Sync any changes back to the persisted store (if there is one)
    // TODO: only sync here if initdb did init db.
    await this.syncToFs()

    this.#ready = true

    // Set the search path to public for this connection
    await this.exec('SET search_path TO public;')

    // Init array types
    await this._initArrayTypes()

    // Init extensions
    for (const initFn of extensionInitFns) {
      await initFn()
    }
  }

  /**
   * The Postgres Emscripten Module
   */
  get Module() {
    return this.mod!
  }

  /**
   * The ready state of the database
   */
  get ready() {
    return this.#ready && !this.#closing && !this.#closed
  }

  /**
   * The closed state of the database
   */
  get closed() {
    return this.#closed
  }

  /**
   * Close the database
   * @returns A promise that resolves when the database is closed
   */
  async close() {
    await this._checkReady()
    this.#closing = true

    // Close all extensions
    for (const closeFn of this.#extensionsClose) {
      await closeFn()
    }

    // Close the database
    try {
      await this.execProtocol(serialize.end())
      this.mod!._pgl_shutdown()
    } catch (e) {
      const err = e as { name: string; status: number }
      if (err.name === 'ExitStatus' && err.status === 0) {
        // Database closed successfully
        // An earlier build of PGlite would throw an error here when closing
        // leaving this here for now. I believe it was a bug in Emscripten.
      } else {
        throw e
      }
    }

    // Close the filesystem
    await this.fs!.closeFs()

    this.#closed = true
    this.#closing = false
  }

  /**
   * Close the database when the object exits scope
   * Stage 3 ECMAScript Explicit Resource Management
   * https://www.typescriptlang.org/docs/handbook/release-notes/typescript-5-2.html#using-declarations-and-explicit-resource-management
   */
  async [Symbol.asyncDispose]() {
    await this.close()
  }

  /**
   * Handle a file attached to the current query
   * @param file The file to handle
   */
  async _handleBlob(blob?: File | Blob) {
    this.#queryReadBuffer = blob ? await blob.arrayBuffer() : undefined
  }

  /**
   * Cleanup the current file
   */
  async _cleanupBlob() {
    this.#queryReadBuffer = undefined
  }

  /**
   * Get the written blob from the current query
   * @returns The written blob
   */
  async _getWrittenBlob(): Promise<Blob | undefined> {
    if (!this.#queryWriteChunks) {
      return undefined
    }
    const blob = new Blob(this.#queryWriteChunks)
    this.#queryWriteChunks = undefined
    return blob
  }

  /**
   * Wait for the database to be ready
   */
  async _checkReady() {
    if (this.#closing) {
      throw new Error('PGlite is closing')
    }
    if (this.#closed) {
      throw new Error('PGlite is closed')
    }
    if (!this.#ready) {
      // Starting the database can take a while and it might not be ready yet
      // We'll wait for it to be ready before continuing
      await this.waitReady
    }
  }

  /**
   * Execute a postgres wire protocol synchronously
   * @param message The postgres wire protocol message to execute
   * @returns The direct message data response produced by Postgres
   */
  execProtocolRawSync(
    message: Uint8Array,
    options: { dataTransferContainer?: DataTransferContainer } = {},
  ) {
    let data
    const mod = this.mod!

    // >0 set buffer content type to wire protocol
    mod._use_wire(1)
    const msg_len = message.length

    // TODO: if (message.length>CMA_B) force file

    let currDataTransferContainer =
      options.dataTransferContainer ?? this.#dataTransferContainer

    // do we overflow allocated shared memory segment
    if (message.length >= mod.FD_BUFFER_MAX) currDataTransferContainer = 'file'

    switch (currDataTransferContainer) {
      case 'cma': {
        // set buffer size so answer will be at size+0x2 pointer addr
        mod._interactive_write(message.length)
        // TODO: make it seg num * seg maxsize if multiple channels.
        mod.HEAPU8.set(message, 1)
        break
      }
      case 'file': {
        // Use socketfiles to emulate a socket connection
        const pg_lck = '/tmp/pglite/base/.s.PGSQL.5432.lck.in'
        const pg_in = '/tmp/pglite/base/.s.PGSQL.5432.in'
        mod._interactive_write(0)
        mod.FS.writeFile(pg_lck, message)
        mod.FS.rename(pg_lck, pg_in)
        break
      }
      default:
        throw new Error(
          `Unknown data transfer container: ${currDataTransferContainer}`,
        )
    }

    // execute the message
    mod._interactive_one()

    const channel = mod._get_channel()
    if (channel < 0) currDataTransferContainer = 'file'

    // TODO: use channel value for msg_start
    if (channel > 0) currDataTransferContainer = 'cma'

    switch (currDataTransferContainer) {
      case 'cma': {
        // Read responses from the buffer

        const msg_start = msg_len + 2
        const msg_end = msg_start + mod._interactive_read()
        data = mod.HEAPU8.subarray(msg_start, msg_end)
        break
      }
      case 'file': {
        // Use socketfiles to emulate a socket connection
        const pg_out = '/tmp/pglite/base/.s.PGSQL.5432.out'
        try {
          const fstat = mod.FS.stat(pg_out)
          const stream = mod.FS.open(pg_out, 'r')
          data = new Uint8Array(fstat.size)
          mod.FS.read(stream, data, 0, fstat.size, 0)
          mod.FS.unlink(pg_out)
        } catch (x) {
          // case of single X message.
          data = new Uint8Array(0)
        }
        break
      }
      default:
        throw new Error(
          `Unknown data transfer container: ${currDataTransferContainer}`,
        )
    }

    return data
  }

  /**
   * Execute a postgres wire protocol message directly without wrapping the response.
   * Only use if `execProtocol()` doesn't suite your needs.
   *
   * **Warning:** This bypasses PGlite's protocol wrappers that manage error/notice messages,
   * transactions, and notification listeners. Only use if you need to bypass these wrappers and
   * don't intend to use the above features.
   *
   * @param message The postgres wire protocol message to execute
   * @returns The direct message data response produced by Postgres
   */
  async execProtocolRaw(
    message: Uint8Array,
    { syncToFs = true, dataTransferContainer }: ExecProtocolOptions = {},
  ) {
    const data = this.execProtocolRawSync(message, { dataTransferContainer })
    if (syncToFs) {
      await this.syncToFs()
    }
    return data
  }

  /**
   * Execute a postgres wire protocol message
   * @param message The postgres wire protocol message to execute
   * @returns The result of the query
   */
  async execProtocol(
    message: Uint8Array,
    {
      syncToFs = true,
      throwOnError = true,
      onNotice,
    }: ExecProtocolOptions = {},
  ): Promise<ExecProtocolResult> {
    const data = await this.execProtocolRaw(message, { syncToFs })
    const results: BackendMessage[] = []

    this.#protocolParser.parse(data, (msg) => {
      if (msg instanceof DatabaseError) {
        this.#protocolParser = new ProtocolParser() // Reset the parser
        if (throwOnError) {
          throw msg
        }
        // TODO: Do we want to wrap the error in a custom error?
      } else if (msg instanceof NoticeMessage) {
        if (this.debug > 0) {
          // Notice messages are warnings, we should log them
          console.warn(msg)
        }
        if (onNotice) {
          onNotice(msg)
        }
      } else if (msg instanceof CommandCompleteMessage) {
        // Keep track of the transaction state
        switch (msg.text) {
          case 'BEGIN':
            this.#inTransaction = true
            break
          case 'COMMIT':
          case 'ROLLBACK':
            this.#inTransaction = false
            break
        }
      } else if (msg instanceof NotificationResponseMessage) {
        // We've received a notification, call the listeners
        const listeners = this.#notifyListeners.get(msg.channel)
        if (listeners) {
          listeners.forEach((cb) => {
            // We use queueMicrotask so that the callback is called after any
            // synchronous code has finished running.
            queueMicrotask(() => cb(msg.payload))
          })
        }
        this.#globalNotifyListeners.forEach((cb) => {
          queueMicrotask(() => cb(msg.channel, msg.payload))
        })
      }
      results.push(msg)
    })

    return { messages: results, data }
  }

  /**
   * Check if the database is in a transaction
   * @returns True if the database is in a transaction, false otherwise
   */
  isInTransaction() {
    return this.#inTransaction
  }

  /**
   * Perform any sync operations implemented by the filesystem, this is
   * run after every query to ensure that the filesystem is synced.
   */
  async syncToFs() {
    if (this.#fsSyncScheduled) {
      return
    }
    this.#fsSyncScheduled = true

    const doSync = async () => {
      await this.#fsSyncMutex.runExclusive(async () => {
        this.#fsSyncScheduled = false
        await this.fs!.syncToFs(this.#relaxedDurability)
      })
    }

    if (this.#relaxedDurability) {
      doSync()
    } else {
      await doSync()
    }
  }

  /**
   * Internal log function
   */
  #log(...args: any[]) {
    if (this.debug > 0) {
      console.log(...args)
    }
  }

  /**
   * Listen for a notification
   * @param channel The channel to listen on
   * @param callback The callback to call when a notification is received
   */
  async listen(channel: string, callback: (payload: string) => void) {
    return this._runExclusiveListen(() => this.#listen(channel, callback))
  }

  async #listen(channel: string, callback: (payload: string) => void) {
    const pgChannel = toPostgresName(channel)
    if (!this.#notifyListeners.has(pgChannel)) {
      this.#notifyListeners.set(pgChannel, new Set())
    }
    this.#notifyListeners.get(pgChannel)!.add(callback)
    try {
      await this.exec(`LISTEN ${channel}`)
    } catch (e) {
      this.#notifyListeners.get(pgChannel)!.delete(callback)
      if (this.#notifyListeners.get(pgChannel)?.size === 0) {
        this.#notifyListeners.delete(pgChannel)
      }
      throw e
    }
    return async () => {
      await this.unlisten(pgChannel, callback)
    }
  }

  /**
   * Stop listening for a notification
   * @param channel The channel to stop listening on
   * @param callback The callback to remove
   */
  async unlisten(channel: string, callback?: (payload: string) => void) {
    return this._runExclusiveListen(() => this.#unlisten(channel, callback))
  }

  async #unlisten(channel: string, callback?: (payload: string) => void) {
    const pgChannel = toPostgresName(channel)
    const cleanUp = async () => {
      await this.exec(`UNLISTEN ${channel}`)
      // While that query was running, another query might have subscribed
      // so we need to check again
      if (this.#notifyListeners.get(pgChannel)?.size === 0) {
        this.#notifyListeners.delete(pgChannel)
      }
    }
    if (callback) {
      this.#notifyListeners.get(pgChannel)?.delete(callback)
      if (this.#notifyListeners.get(pgChannel)?.size === 0) {
        await cleanUp()
      }
    } else {
      await cleanUp()
    }
  }

  /**
   * Listen to notifications
   * @param callback The callback to call when a notification is received
   */
  onNotification(
    callback: (channel: string, payload: string) => void,
  ): () => void {
    this.#globalNotifyListeners.add(callback)
    return () => {
      this.#globalNotifyListeners.delete(callback)
    }
  }

  /**
   * Stop listening to notifications
   * @param callback The callback to remove
   */
  offNotification(callback: (channel: string, payload: string) => void) {
    this.#globalNotifyListeners.delete(callback)
  }

  /**
   * Dump the PGDATA dir from the filesystem to a gziped tarball.
   * @param compression The compression options to use - 'gzip', 'auto', 'none'
   * @returns The tarball as a File object where available, and fallback to a Blob
   */
  async dumpDataDir(
    compression?: DumpTarCompressionOptions,
  ): Promise<File | Blob> {
    await this._checkReady()
    const dbname = this.dataDir?.split('/').pop() ?? 'pgdata'
    return this.fs!.dumpTar(dbname, compression)
  }

  /**
   * Run a function in a mutex that's exclusive to queries
   * @param fn The query to run
   * @returns The result of the query
   */
  _runExclusiveQuery<T>(fn: () => Promise<T>): Promise<T> {
    return this.#queryMutex.runExclusive(fn)
  }

  /**
   * Run a function in a mutex that's exclusive to transactions
   * @param fn The function to run
   * @returns The result of the function
   */
  _runExclusiveTransaction<T>(fn: () => Promise<T>): Promise<T> {
    return this.#transactionMutex.runExclusive(fn)
  }

  async clone(): Promise<PGliteInterface> {
    const dump = await this.dumpDataDir('none')
    return PGlite.create({ loadDataDir: dump })
  }

  _runExclusiveListen<T>(fn: () => Promise<T>): Promise<T> {
    return this.#listenMutex.runExclusive(fn)
  }
}
