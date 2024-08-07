import { Mutex } from "async-mutex";
import PostgresModFactory, { type PostgresMod } from "./postgresMod.js";
import { type Filesystem, parseDataDir, loadFs } from "./fs/index.js";
import { makeLocateFile } from "./utils.js";
import { parseResults } from "./parse.js";
import { serializeType } from "./types.js";
import type {
  DebugLevel,
  PGliteOptions,
  PGliteInterface,
  Results,
  Transaction,
  QueryOptions,
  ExecProtocolOptions,
  PGliteInterfaceExtensions,
  Extensions,
} from "./interface.js";
import { loadExtensionBundle, loadExtensions } from "./extensionUtils.js";
import { loadTar } from "./fs/tarUtils.js";
import { Buffer } from "./polyfills/buffer.js";

import { PGDATA, WASM_PREFIX } from "./fs/index.js";

// Importing the source as the built version is not ESM compatible
import { serialize } from "pg-protocol/src/index.js";
import { Parser } from "pg-protocol/src/parser.js";
import {
  BackendMessage,
  DatabaseError,
  NoticeMessage,
  CommandCompleteMessage,
  NotificationResponseMessage,
} from "pg-protocol/src/messages.js";

export class PGlite implements PGliteInterface, AsyncDisposable {
  fs?: Filesystem;
  protected mod?: PostgresMod;

  readonly dataDir?: string;

  #ready = false;
  #closing = false;
  #closed = false;
  #inTransaction = false;
  #relaxedDurability = false;

  readonly waitReady: Promise<void>;

  #executeMutex = new Mutex();
  #queryMutex = new Mutex();
  #transactionMutex = new Mutex();
  #fsSyncMutex = new Mutex();
  #fsSyncScheduled = false;

  readonly debug: DebugLevel = 0;

  #extensions: Extensions;
  #extensionsClose: Array<() => Promise<void>> = [];

  #parser = new Parser();

  // These are the current ArrayBuffer that is being read or written to
  // during a query, such as COPY FROM or COPY TO.
  #queryReadBuffer?: ArrayBuffer;
  #queryWriteChunks?: Uint8Array[];

  #notifyListeners = new Map<string, Set<(payload: string) => void>>();
  #globalNotifyListeners = new Set<
    (channel: string, payload: string) => void
  >();

  /**
   * Create a new PGlite instance
   * @param dataDir The directory to store the database files
   *                Prefix with idb:// to use indexeddb filesystem in the browser
   *                Use memory:// to use in-memory filesystem
   * @param options Optional options
   */
  constructor(dataDir?: string, options?: PGliteOptions);

  /**
   * Create a new PGlite instance
   * @param options PGlite options including the data directory
   */
  constructor(options?: PGliteOptions);

  constructor(
    dataDirOrPGliteOptions: string | PGliteOptions = {},
    options: PGliteOptions = {}
  ) {
    if (typeof dataDirOrPGliteOptions === "string") {
      options = {
        dataDir: dataDirOrPGliteOptions,
        ...options,
      };
    } else {
      options = dataDirOrPGliteOptions;
    }
    this.dataDir = options.dataDir;

    // Enable debug logging if requested
    if (options?.debug !== undefined) {
      this.debug = options.debug;
    }

    // Enable relaxed durability if requested
    if (options?.relaxedDurability !== undefined) {
      this.#relaxedDurability = options.relaxedDurability;
    }

    // Save the extensions for later use
    this.#extensions = options.extensions ?? {};

    // Initialize the database, and store the promise so we can wait for it to be ready
    this.waitReady = this.#init(options ?? {});
  }

  /**
   * Create a new PGlite instance with extensions on the Typescript interface
   * (The main constructor does enable extensions, however due to the limitations
   * of Typescript, the extensions are not available on the instance interface)
   * @param dataDir The directory to store the database files
   *                Prefix with idb:// to use indexeddb filesystem in the browser
   *                Use memory:// to use in-memory filesystem
   * @param options Optional options
   * @returns A promise that resolves to the PGlite instance when it's ready.
   */
  static async create<O extends PGliteOptions>(
    options?: O
  ): Promise<PGlite & PGliteInterfaceExtensions<O["extensions"]>> {
    const pg = new PGlite(options);
    await pg.waitReady;
    return pg as any;
  }

  /**
   * Initialize the database
   * @returns A promise that resolves when the database is ready
   */
  async #init(options: PGliteOptions) {
    if (options.fs) {
      this.fs = options.fs;
    } else {
      const { dataDir, fsType } = parseDataDir(options.dataDir);
      this.fs = await loadFs(dataDir, fsType);
    }

    const extensionBundlePromises: Record<string, Promise<Blob | null>> = {};
    const extensionInitFns: Array<() => Promise<void>> = [];

    const args = [
      `PGDATA=${PGDATA}`,
      `PREFIX=${WASM_PREFIX}`,
      `PGUSER=${options.username ?? "postgres"}`,
      `PGDATABASE=template1`, // TODO: allow custom db
      "MODE=REACT",
      "REPL=N",
      // "-F", // Disable fsync (TODO: Only for in-memory mode?)
      ...(this.debug ? ["-d", this.debug.toString()] : []),
    ];

    let emscriptenOpts: Partial<PostgresMod> = {
      WASM_PREFIX,
      arguments: args,
      noExitRuntime: true,
      ...(this.debug > 0
        ? { print: console.info, printErr: console.error }
        : { print: () => {}, printErr: () => {} }),
      locateFile: await makeLocateFile(),
      preRun: [
        (mod: any) => {
          // Register /dev/blob device
          // This is used to read and write blobs when used in COPY TO/FROM
          // e.g. COPY mytable TO '/dev/blob' WITH (FORMAT binary)
          // The data is returned by the query as a `blob` property in the results
          const devId = mod.FS.makedev(64, 0);
          let callCounter = 0;
          const devOpt = {
            open: (stream: any) => {},
            close: (stream: any) => {},
            read: (
              stream: any,
              buffer: Uint8Array,
              offset: number,
              length: number,
              position: number
            ) => {
              const buf = this.#queryReadBuffer;
              if (!buf) {
                throw new Error("No File or Blob provided to read from");
              }
              const contents = new Uint8Array(buf);
              if (position >= contents.length) return 0;
              const size = Math.min(contents.length - position, length);
              for (let i = 0; i < size; i++) {
                buffer[offset + i] = contents[position + i];
              }
              return size;
            },
            write: (
              stream: any,
              buffer: Uint8Array,
              offset: number,
              length: number,
              position: number
            ) => {
              callCounter++;
              this.#queryWriteChunks ??= [];
              this.#queryWriteChunks.push(
                buffer.slice(offset, offset + length)
              );
              return length;
            },
            llseek: (stream: any, offset: number, whence: number) => {
              throw new Error("Cannot seek /dev/blob");
            },
          };
          mod.FS.registerDevice(devId, devOpt);
          mod.FS.mkdev("/dev/blob", devId);
        },
      ],
    };

    emscriptenOpts = await this.fs!.emscriptenOpts(emscriptenOpts);

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
        extensionBundlePromises[extName] = loadExtensionBundle(ext);
      } else {
        // Extension with JS setup function
        const extRet = await ext.setup(this, emscriptenOpts);
        if (extRet.emscriptenOpts) {
          emscriptenOpts = extRet.emscriptenOpts;
        }
        if (extRet.namespaceObj) {
          (this as any)[extName] = extRet.namespaceObj;
        }
        if (extRet.bundlePath) {
          extensionBundlePromises[extName] = loadExtensionBundle(
            extRet.bundlePath
          ); // Don't await here, this is parallel
        }
        if (extRet.init) {
          extensionInitFns.push(extRet.init);
        }
        if (extRet.close) {
          this.#extensionsClose.push(extRet.close);
        }
      }
    }
    emscriptenOpts["pg_extensions"] = extensionBundlePromises;

    // Load the database engine
    this.mod = await PostgresModFactory(emscriptenOpts);

    // Sync the filesystem from any previous store
    await this.fs!.initialSyncFs(this.mod.FS);

    // If the user has provided a tarball to load the database from, do that now.
    // We do this after the initial sync so that we can throw if the database
    // already exists.
    if (options.loadDataDir) {
      if (this.mod.FS.analyzePath(PGDATA + "/PG_VERSION").exists) {
        throw new Error("Database already exists, cannot load from tarball");
      }
      this.#log("pglite: loading data from tarball");
      await loadTar(this.mod.FS, options.loadDataDir);
    }

    // Check and log if the database exists
    if (this.mod.FS.analyzePath(PGDATA + "/PG_VERSION").exists) {
      this.#log("pglite: found DB, resuming");
    } else {
      this.#log("pglite: no db");
    }

    // Start compiling dynamic extensions present in FS.
    await loadExtensions(this.mod, (...args) => this.#log(...args));

    // Initialize the database
    const idb = this.mod._pg_initdb();

    if (!idb) {
      // This would be a sab worker crash before pg_initdb can be called
      throw new Error("INITDB failed to return value");
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
      throw new Error("INITDB failed");
    } else if (idb & 0b0010) {
      // initdb was called to init PGDATA if required
      const pguser = options.username ?? "postgres";
      const pgdatabase = "template1"; // TODO: allow custom db
      if (idb & 0b0100) {
        // initdb has found a previous database
        if (idb & (0b0100 | 0b1000)) {
          // initdb found db+user, and we switched to that user
        } else {
          // TODO: invalid user for db?
          throw new Error("Invalid db/user combination");
        }
      } else {
        // initdb has created a new database for us, we can only continue if we are
        // in template1 and the user is postgres
        if (pgdatabase !== "template1" && pguser !== "postgres") {
          // throw new Error(`Invalid database ${pgdatabase} requested`);
          throw new Error(
            "INITDB created a new datadir, but an alternative db/user was requested"
          );
        }
      }
    }

    // Sync any changes back to the persisted store (if there is one)
    // TODO: only sync here if initdb did init db.
    await this.#syncToFs();

    // Set the search path to public for this connection
    await this.#runExec("SET search_path TO public;");

    this.#ready = true;

    // Init extensions
    for (const initFn of extensionInitFns) {
      await initFn();
    }
  }

  /**
   * The Postgres Emscripten Module
   */
  get Module() {
    return this.mod!;
  }

  /**
   * The ready state of the database
   */
  get ready() {
    return this.#ready && !this.#closing && !this.#closed;
  }

  /**
   * The closed state of the database
   */
  get closed() {
    return this.#closed;
  }

  /**
   * Close the database
   * @returns A promise that resolves when the database is closed
   */
  async close() {
    await this.#checkReady();
    this.#closing = true;

    // Close all extensions
    for (const closeFn of this.#extensionsClose) {
      await closeFn();
    }

    // Close the database
    try {
      await this.execProtocol(serialize.end());
    } catch (e) {
      const err = e as { name: string; status: number };
      if (err.name === "ExitStatus" && err.status === 0) {
        // Database closed successfully
        // An earlier build of PGlite would throw an error here when closing
        // leaving this here for now. I believe it was a bug in Emscripten.
      } else {
        throw e;
      }
    }

    // Close the filesystem
    await this.fs!.close(this.mod!.FS);

    this.#closed = true;
    this.#closing = false;
  }

  /**
   * Close the database when the object exits scope
   * Stage 3 ECMAScript Explicit Resource Management
   * https://www.typescriptlang.org/docs/handbook/release-notes/typescript-5-2.html#using-declarations-and-explicit-resource-management
   */
  async [Symbol.asyncDispose]() {
    await this.close();
  }

  /**
   * Execute a single SQL statement
   * This uses the "Extended Query" postgres wire protocol message.
   * @param query The query to execute
   * @param params Optional parameters for the query
   * @returns The result of the query
   */
  async query<T>(
    query: string,
    params?: any[],
    options?: QueryOptions
  ): Promise<Results<T>> {
    await this.#checkReady();
    // We wrap the public query method in the transaction mutex to ensure that
    // only one query can be executed at a time and not concurrently with a
    // transaction.
    return await this.#transactionMutex.runExclusive(async () => {
      return await this.#runQuery<T>(query, params, options);
    });
  }

  /**
   * Execute a SQL query, this can have multiple statements.
   * This uses the "Simple Query" postgres wire protocol message.
   * @param query The query to execute
   * @returns The result of the query
   */
  async exec(query: string, options?: QueryOptions): Promise<Array<Results>> {
    await this.#checkReady();
    // We wrap the public exec method in the transaction mutex to ensure that
    // only one query can be executed at a time and not concurrently with a
    // transaction.
    return await this.#transactionMutex.runExclusive(async () => {
      return await this.#runExec(query, options);
    });
  }

  /**
   * Internal method to execute a query
   * Not protected by the transaction mutex, so it can be used inside a transaction
   * @param query The query to execute
   * @param params Optional parameters for the query
   * @returns The result of the query
   */
  async #runQuery<T>(
    query: string,
    params?: any[],
    options?: QueryOptions
  ): Promise<Results<T>> {
    return await this.#queryMutex.runExclusive(async () => {
      // We need to parse, bind and execute a query with parameters
      this.#log("runQuery", query, params, options);
      await this.#handleBlob(options?.blob);
      const parsedParams = params?.map((p) => serializeType(p)) || [];
      let results;
      try {
        results = [
          ...(await this.#execProtocolNoSync(
            serialize.parse({
              text: query,
              types: parsedParams.map(([, type]) => type),
            }),
            options
          )),
          ...(await this.#execProtocolNoSync(
            serialize.bind({
              values: parsedParams.map(([val]) => val),
            }),
            options
          )),
          ...(await this.#execProtocolNoSync(
            serialize.describe({ type: "P" }),
            options
          )),
          ...(await this.#execProtocolNoSync(serialize.execute({}), options)),
        ];
      } finally {
        await this.#execProtocolNoSync(serialize.sync(), options);
      }
      this.#cleanupBlob();
      if (!this.#inTransaction) {
        await this.#syncToFs();
      }
      let blob: Blob | undefined;
      if (this.#queryWriteChunks) {
        blob = new Blob(this.#queryWriteChunks);
        this.#queryWriteChunks = undefined;
      }
      return parseResults(
        results.map(([msg]) => msg),
        options,
        blob
      )[0] as Results<T>;
    });
  }

  /**
   * Internal method to execute a query
   * Not protected by the transaction mutex, so it can be used inside a transaction
   * @param query The query to execute
   * @param params Optional parameters for the query
   * @returns The result of the query
   */
  async #runExec(
    query: string,
    options?: QueryOptions
  ): Promise<Array<Results>> {
    return await this.#queryMutex.runExclusive(async () => {
      // No params so we can just send the query
      this.#log("runExec", query, options);
      await this.#handleBlob(options?.blob);
      let results;
      try {
        results = await this.#execProtocolNoSync(
          serialize.query(query),
          options
        );
      } finally {
        await this.#execProtocolNoSync(serialize.sync(), options);
      }
      this.#cleanupBlob();
      if (!this.#inTransaction) {
        await this.#syncToFs();
      }
      let blob: Blob | undefined;
      if (this.#queryWriteChunks) {
        blob = new Blob(this.#queryWriteChunks);
        this.#queryWriteChunks = undefined;
      }
      return parseResults(
        results.map(([msg]) => msg),
        options,
        blob
      ) as Array<Results>;
    });
  }

  /**
   * Execute a transaction
   * @param callback A callback function that takes a transaction object
   * @returns The result of the transaction
   */
  async transaction<T>(
    callback: (tx: Transaction) => Promise<T>
  ): Promise<T | undefined> {
    await this.#checkReady();
    return await this.#transactionMutex.runExclusive(async () => {
      await this.#runExec("BEGIN");

      // Once a transaction is closed, we throw an error if it's used again
      let closed = false;
      const checkClosed = () => {
        if (closed) {
          throw new Error("Transaction is closed");
        }
      };

      try {
        const tx: Transaction = {
          query: async (
            query: string,
            params?: any[],
            options?: QueryOptions
          ) => {
            checkClosed();
            return await this.#runQuery(query, params, options);
          },
          exec: async (query: string, options?: QueryOptions) => {
            checkClosed();
            return await this.#runExec(query, options);
          },
          rollback: async () => {
            checkClosed();
            // Rollback and set the closed flag to prevent further use of this
            // transaction
            await this.#runExec("ROLLBACK");
            closed = true;
          },
          get closed() {
            return closed;
          },
        };
        const result = await callback(tx);
        if (!closed) {
          closed = true;
          await this.#runExec("COMMIT");
        }
        return result;
      } catch (e) {
        if (!closed) {
          await this.#runExec("ROLLBACK");
        }
        throw e;
      }
    });
  }

  /**
   * Handle a file attached to the current query
   * @param file The file to handle
   */
  async #handleBlob(blob?: File | Blob) {
    this.#queryReadBuffer = blob ? await blob.arrayBuffer() : undefined;
  }

  /**
   * Cleanup the current file
   */
  #cleanupBlob() {
    this.#queryReadBuffer = undefined;
  }

  /**
   * Wait for the database to be ready
   */
  async #checkReady() {
    if (this.#closing) {
      throw new Error("PGlite is closing");
    }
    if (this.#closed) {
      throw new Error("PGlite is closed");
    }
    if (!this.#ready) {
      // Starting the database can take a while and it might not be ready yet
      // We'll wait for it to be ready before continuing
      await this.waitReady;
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
    { syncToFs = true }: ExecProtocolOptions = {}
  ) {
    const msg_len = message.length;
    const mod = this.mod!;

    // >0 set buffer content type to wire protocol
    // set buffer size so answer will be at size+0x2 pointer addr
    mod._interactive_write(msg_len);

    // copy whole buffer at addr 0x1
    mod.HEAPU8.set(message, 1);

    // execute the message
    mod._interactive_one();

    // Read responses from the buffer
    const msg_start = msg_len + 2;
    const msg_end = msg_start + mod._interactive_read();
    const data = mod.HEAPU8.subarray(msg_start, msg_end);

    if (syncToFs) {
      await this.#syncToFs();
    }

    return data;
  }

  /**
   * Execute a postgres wire protocol message
   * @param message The postgres wire protocol message to execute
   * @returns The result of the query
   */
  async execProtocol(
    message: Uint8Array,
    { syncToFs = true, onNotice }: ExecProtocolOptions = {}
  ): Promise<Array<[BackendMessage, Uint8Array]>> {
    const data = await this.execProtocolRaw(message, { syncToFs });
    const results: Array<[BackendMessage, Uint8Array]> = [];

    this.#parser.parse(Buffer.from(data), (msg) => {
      if (msg instanceof DatabaseError) {
        this.#parser = new Parser(); // Reset the parser
        throw msg;
        // TODO: Do we want to wrap the error in a custom error?
      } else if (msg instanceof NoticeMessage) {
        if (this.debug > 0) {
          // Notice messages are warnings, we should log them
          console.warn(msg);
        }
        if (onNotice) {
          onNotice(msg);
        }
      } else if (msg instanceof CommandCompleteMessage) {
        // Keep track of the transaction state
        switch (msg.text) {
          case "BEGIN":
            this.#inTransaction = true;
            break;
          case "COMMIT":
          case "ROLLBACK":
            this.#inTransaction = false;
            break;
        }
      } else if (msg instanceof NotificationResponseMessage) {
        // We've received a notification, call the listeners
        const listeners = this.#notifyListeners.get(msg.channel);
        if (listeners) {
          listeners.forEach((cb) => {
            // We use queueMicrotask so that the callback is called after any
            // synchronous code has finished running.
            queueMicrotask(() => cb(msg.payload));
          });
        }
        this.#globalNotifyListeners.forEach((cb) => {
          queueMicrotask(() => cb(msg.channel, msg.payload));
        });
      }
      results.push([msg, data]);
    });

    return results;
  }

  async #execProtocolNoSync(
    message: Uint8Array,
    options: ExecProtocolOptions = {}
  ): Promise<Array<[BackendMessage, Uint8Array]>> {
    return await this.execProtocol(message, { ...options, syncToFs: false });
  }

  /**
   * Perform any sync operations implemented by the filesystem, this is
   * run after every query to ensure that the filesystem is synced.
   */
  async #syncToFs() {
    if (this.#fsSyncScheduled) {
      return;
    }
    this.#fsSyncScheduled = true;

    const doSync = async () => {
      await this.#fsSyncMutex.runExclusive(async () => {
        this.#fsSyncScheduled = false;
        await this.fs!.syncToFs(this.mod!.FS, this.#relaxedDurability);
      });
    };

    if (this.#relaxedDurability) {
      doSync();
    } else {
      await doSync();
    }
  }

  /**
   * Internal log function
   */
  #log(...args: any[]) {
    if (this.debug > 0) {
      console.log(...args);
    }
  }

  /**
   * Listen for a notification
   * @param channel The channel to listen on
   * @param callback The callback to call when a notification is received
   */
  async listen(channel: string, callback: (payload: string) => void) {
    if (!this.#notifyListeners.has(channel)) {
      this.#notifyListeners.set(channel, new Set());
    }
    this.#notifyListeners.get(channel)!.add(callback);
    await this.exec(`LISTEN ${channel}`);
    return async () => {
      await this.unlisten(channel, callback);
    };
  }

  /**
   * Stop listening for a notification
   * @param channel The channel to stop listening on
   * @param callback The callback to remove
   */
  async unlisten(channel: string, callback?: (payload: string) => void) {
    if (callback) {
      this.#notifyListeners.get(channel)?.delete(callback);
      if (this.#notifyListeners.get(channel)?.size === 0) {
        await this.exec(`UNLISTEN ${channel}`);
        this.#notifyListeners.delete(channel);
      }
    } else {
      await this.exec(`UNLISTEN ${channel}`);
      this.#notifyListeners.delete(channel);
    }
  }

  /**
   * Listen to notifications
   * @param callback The callback to call when a notification is received
   */
  onNotification(
    callback: (channel: string, payload: string) => void
  ): () => void {
    this.#globalNotifyListeners.add(callback);
    return () => {
      this.#globalNotifyListeners.delete(callback);
    };
  }

  /**
   * Stop listening to notifications
   * @param callback The callback to remove
   */
  offNotification(callback: (channel: string, payload: string) => void) {
    this.#globalNotifyListeners.delete(callback);
  }

  /**
   * Dump the PGDATA dir from the filesystem to a gziped tarball.
   * @returns The tarball as a File object where available, and fallback to a Blob
   */
  async dumpDataDir() {
    let dbname = this.dataDir?.split("/").pop() ?? "pgdata";
    return this.fs!.dumpTar(this.mod!.FS, dbname);
  }
}
