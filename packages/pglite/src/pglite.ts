import { Mutex } from 'async-mutex'
import PostgresModFactory, { type PostgresMod } from './postgresMod.js'
import { type Filesystem, parseDataDir, loadFs } from './fs/index.js'
import { instantiateWasm, getFsBundle, startWasmDownload } from './utils.js'
import type {
  DebugLevel,
  PGliteOptions,
  PGliteInterface,
  ExecProtocolOptions,
  PGliteInterfaceExtensions,
  Extensions,
} from './interface.js'
import { BasePGlite } from './base.js'
import { loadExtensionBundle, loadExtensions } from './extensionUtils.js'
import { loadTar, DumpTarCompressionOptions } from './fs/tarUtils.js'
import { PGDATA, WASM_PREFIX } from './fs/index.js'

// Importing the source as the built version is not ESM compatible
import { serialize, Parser as ProtocolParser } from '@electric-sql/pg-protocol'
import {
  BackendMessage,
  DatabaseError,
  NoticeMessage,
  CommandCompleteMessage,
  NotificationResponseMessage,
} from '@electric-sql/pg-protocol/messages'

const SOCKET_FILE = {
  ILOCK: '/tmp/pglite/.s.PGSQL.5432.lock.in',
  IN: '/tmp/pglite/.s.PGSQL.5432.in',
  OLOCK: '/tmp/pglite/.s.PGSQL.5432.lock.out',
  OUT: '/tmp/pglite/.s.PGSQL.5432.out',
}

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
  #fsSyncMutex = new Mutex()
  #fsSyncScheduled = false

  readonly debug: DebugLevel = 0

  #extensions: Extensions
  #extensionsClose: Array<() => Promise<void>> = []

  #protocolParser = new ProtocolParser()

  #queryInBuffer?: ArrayBuffer
  #queryOutChunks?: Uint8Array[]

  // These are the current /dev/blob ArrayBuffer that is being read or written to
  // during a query, such as COPY FROM or COPY TO.
  #devBlobReadBuffer?: ArrayBuffer
  #devBlobWriteChunks?: Uint8Array[]

  #notifyListeners = new Map<string, Set<(payload: string) => void>>()
  #globalNotifyListeners = new Set<(channel: string, payload: string) => void>()

  #socketInDevId?: number
  #socketOutDevId?: number

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

    // Enable debug logging if requested
    if (options?.debug !== undefined) {
      this.debug = options.debug
    }

    // Enable relaxed durability if requested
    if (options?.relaxedDurability !== undefined) {
      this.#relaxedDurability = options.relaxedDurability
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

  static async create<O extends PGliteOptions>(
    dataDirOrPGliteOptions?: string | O,
    options?: O,
  ): Promise<PGlite & PGliteInterfaceExtensions<O['extensions']>> {
    const resolvedOpts: PGliteOptions =
      typeof dataDirOrPGliteOptions === 'string'
        ? {
            dataDir: dataDirOrPGliteOptions,
            ...(options ?? {}),
          }
        : dataDirOrPGliteOptions ?? {}

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
        if (remotePackageName === 'postgres.data') {
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
              const buf = this.#devBlobReadBuffer
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
              this.#devBlobWriteChunks ??= []
              this.#devBlobWriteChunks.push(
                buffer.slice(offset, offset + length),
              )
              return length
            },
            llseek: (stream: any, offset: number, whence: number) => {
              const buf = this.#devBlobReadBuffer
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
    const idb = this.mod._pg_initdb()

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
      throw new Error('INITDB failed')
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
          throw new Error('Invalid db/user combination')
        }
      } else {
        // initdb has created a new database for us, we can only continue if we are
        // in template1 and the user is postgres
        if (pgdatabase !== 'template1' && pguser !== 'postgres') {
          // throw new Error(`Invalid database ${pgdatabase} requested`);
          throw new Error(
            'INITDB created a new datadir, but an alternative db/user was requested',
          )
        }
      }
    }

    // Sync any changes back to the persisted store (if there is one)
    // TODO: only sync here if initdb did init db.
    await this.syncToFs()

    // Setup the socket files for the query protocol IO
    this.#setupSocketDevices()

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

  #setupSocketDevices() {
    const mod = this.mod!

    // Register SOCKET_FILE.IN device
    this.#socketInDevId = mod.FS.makedev(63, 0)
    const inDevOpt = {
      open: (_stream: any) => {},
      close: (_stream: any) => {},
      read: (
        _stream: any,
        buffer: Uint8Array,
        offset: number,
        length: number,
        position: number,
      ) => {
        const buf = this.#queryInBuffer
        if (!buf) {
          throw new Error(`No ${SOCKET_FILE.IN} Buffer provided to read from`)
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
        _buffer: Uint8Array,
        _offset: number,
        _length: number,
        _position: number,
      ) => {
        throw new Error('Not implemented')
      },
      llseek: (stream: any, offset: number, whence: number) => {
        const buf = this.#queryInBuffer
        if (!buf) {
          throw new Error(`No ${SOCKET_FILE.IN} Buffer provided to llseek`)
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
    mod.FS.registerDevice(this.#socketInDevId!, inDevOpt)

    // Register SOCKET_FILE.OUT devicex
    this.#socketOutDevId = mod.FS.makedev(62, 0)
    const outDevOpt = {
      open: (_stream: any) => {},
      close: (_stream: any) => {},
      read: (
        _stream: any,
        _buffer: Uint8Array,
        _offset: number,
        _length: number,
        _position: number,
      ) => {
        throw new Error('Not implemented')
      },
      write: (
        _stream: any,
        buffer: Uint8Array,
        offset: number,
        length: number,
        _position: number,
      ) => {
        this.#queryOutChunks ??= []
        this.#queryOutChunks.push(buffer.slice(offset, offset + length))
        return length
      },
      llseek: (_stream: any, _offset: number, _whence: number) => {
        throw new Error('Not implemented')
      },
    }
    mod.FS.registerDevice(this.#socketOutDevId!, outDevOpt)

    this.#makeSocketFiles()

    mod._use_socketfile()
  }

  #makeSocketFiles() {
    const mod = this.mod!
    if (!mod.FS.analyzePath(SOCKET_FILE.IN).exists) {
      mod.FS.mkdev(SOCKET_FILE.IN, this.#socketInDevId!)
    }
    if (!mod.FS.analyzePath(SOCKET_FILE.OUT).exists) {
      mod.FS.mkdev(SOCKET_FILE.OUT, this.#socketOutDevId!)
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
      this.mod!._pg_shutdown()
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
    this.#devBlobReadBuffer = blob ? await blob.arrayBuffer() : undefined
  }

  /**
   * Cleanup the current file
   */
  async _cleanupBlob() {
    this.#devBlobReadBuffer = undefined
  }

  /**
   * Get the written blob from the current query
   * @returns The written blob
   */
  async _getWrittenBlob(): Promise<Blob | undefined> {
    if (!this.#devBlobWriteChunks) {
      return undefined
    }
    const blob = new Blob(this.#devBlobWriteChunks)
    this.#devBlobWriteChunks = undefined
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
    { syncToFs = true }: ExecProtocolOptions = {},
  ) {
    // Make query available at /dev/query-in
    this.#queryInBuffer = message

    // Remove the lock files if they exist
    const mod = this.mod!
    if (mod.FS.analyzePath(SOCKET_FILE.OLOCK).exists) {
      mod.FS.unlink(SOCKET_FILE.OLOCK)
    }
    if (mod.FS.analyzePath(SOCKET_FILE.OLOCK).exists) {
      mod.FS.unlink(SOCKET_FILE.OLOCK)
    }

    this.#makeSocketFiles()

    // execute the message
    this.#queryOutChunks = []
    this.mod!._interactive_one()

    // Read responses from SOCKET_FILE.OUT
    const data = await new Blob(this.#queryOutChunks).arrayBuffer()
    this.#queryOutChunks = undefined

    if (syncToFs) {
      await this.syncToFs()
    }

    return new Uint8Array(data)
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
  ): Promise<Array<[BackendMessage, Uint8Array]>> {
    const data = await this.execProtocolRaw(message, { syncToFs })
    const results: Array<[BackendMessage, Uint8Array]> = []

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
      results.push([msg, data])
    })

    return results
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
    if (!this.#notifyListeners.has(channel)) {
      this.#notifyListeners.set(channel, new Set())
    }
    this.#notifyListeners.get(channel)!.add(callback)
    await this.exec(`LISTEN "${channel}"`)
    return async () => {
      await this.unlisten(channel, callback)
    }
  }

  /**
   * Stop listening for a notification
   * @param channel The channel to stop listening on
   * @param callback The callback to remove
   */
  async unlisten(channel: string, callback?: (payload: string) => void) {
    if (callback) {
      this.#notifyListeners.get(channel)?.delete(callback)
      if (this.#notifyListeners.get(channel)?.size === 0) {
        await this.exec(`UNLISTEN "${channel}"`)
        this.#notifyListeners.delete(channel)
      }
    } else {
      await this.exec(`UNLISTEN "${channel}"`)
      this.#notifyListeners.delete(channel)
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
}
