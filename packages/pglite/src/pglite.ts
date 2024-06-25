import { Mutex } from "async-mutex";
import EmPostgresFactory, { type EmPostgres } from "../release/postgres.js";
import { type Filesystem, parseDataDir, loadFs } from "./fs/index.js";
import { makeLocateFile } from "./utils.js";
import { PGEvent } from "./event.js";
import { parseResults } from "./parse.js";
import { serializeType } from "./types.js";
import type {
  DebugLevel,
  PGliteOptions,
  FilesystemType,
  PGliteInterface,
  Results,
  Transaction,
  QueryOptions,
  ExecProtocolOptions,
} from "./interface.js";

// Importing the source as the built version is not ESM compatible
import { serialize } from "pg-protocol/dist/index.js";
import { Parser } from "pg-protocol/dist/parser.js";
import {
  BackendMessage,
  DatabaseError,
  NoticeMessage,
  CommandCompleteMessage,
  NotificationResponseMessage,
} from "pg-protocol/dist/messages.js";

export class PGlite implements PGliteInterface {
  readonly dataDir?: string;
  readonly fsType: FilesystemType;
  protected fs?: Filesystem;
  protected emp?: any;

  #initStarted = false;
  #ready = false;
  #eventTarget: EventTarget;
  #closing = false;
  #closed = false;
  #inTransaction = false;
  #relaxedDurability = false;

  #resultAccumulator: Uint8Array[] = [];

  readonly waitReady: Promise<void>;

  #executeMutex = new Mutex();
  #queryMutex = new Mutex();
  #transactionMutex = new Mutex();
  #fsSyncMutex = new Mutex();
  #fsSyncScheduled = false;

  readonly debug: DebugLevel = 0;

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
  constructor(dataDir?: string, options?: PGliteOptions) {
    const { dataDir: dir, fsType } = parseDataDir(dataDir);
    this.dataDir = dir;
    this.fsType = fsType;

    // Enable debug logging if requested
    if (options?.debug !== undefined) {
      this.debug = options.debug;
    }

    // Enable relaxed durability if requested
    if (options?.relaxedDurability !== undefined) {
      this.#relaxedDurability = options.relaxedDurability;
    }

    // Create an event target to handle events from the emscripten module
    this.#eventTarget = new EventTarget();

    // Listen for result events from the emscripten module and accumulate them
    this.#eventTarget.addEventListener("result", async (e: any) => {
      this.#resultAccumulator.push(e.detail);
    });

    // Initialize the database, and store the promise so we can wait for it to be ready
    this.waitReady = this.#init();
  }

  /**
   * Initialize the database
   * @returns A promise that resolves when the database is ready
   */
  async #init() {
    let firstRun = false;
    await new Promise<void>(async (resolve, reject) => {
      if (this.#initStarted) {
        throw new Error("Already initializing");
      }
      this.#initStarted = true;

      // Load a filesystem based on the type
      this.fs = await loadFs(this.dataDir, this.fsType);

      // Initialize the filesystem
      // returns true if this is the first run, we then need to perform
      // additional setup steps at the end of the init.
      firstRun = await this.fs.init(this.debug);

      let emscriptenOpts: Partial<EmPostgres> = {
        arguments: [
          "--single", // Single user mode
          "-F", // Disable fsync (TODO: Only for in-memory mode?)
          "-O", // Allow the structure of system tables to be modified. This is used by initdb
          "-j", // Single use mode - Use semicolon followed by two newlines, rather than just newline, as the command entry terminator.
          "-c", // Set parameter
          "search_path=pg_catalog",
          "-c",
          "dynamic_shared_memory_type=mmap",
          "-c",
          "max_prepared_transactions=10",
          // Debug level
          ...(this.debug ? ["-d", this.debug.toString()] : []),
          "-D", // Data directory
          "/pgdata",
          "template1",
        ],
        locateFile: await makeLocateFile(),
        ...(this.debug > 0
          ? { print: console.info, printErr: console.error }
          : { print: () => {}, printErr: () => {} }),
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
                position: number,
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
                position: number,
              ) => {
                callCounter++;
                this.#queryWriteChunks ??= [];
                this.#queryWriteChunks.push(
                  buffer.slice(offset, offset + length),
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
        onRuntimeInitialized: async (Module: EmPostgres) => {
          await this.fs!.initialSyncFs(Module.FS);
          this.#ready = true;
          resolve();
        },
        eventTarget: this.#eventTarget,
        Event: PGEvent,
      };

      emscriptenOpts = await this.fs.emscriptenOpts(emscriptenOpts);
      const emp = await EmPostgresFactory(emscriptenOpts);
      this.emp = emp;
    });

    if (firstRun) {
      await this.#firstRun();
    }
    await this.#runExec(`
      SET search_path TO public;
    `);
  }

  /**
   * Perform the first run initialization of the database
   * This is only run when the database is first created
   */
  async #firstRun() {
    const shareDir = "/usr/local/pgsql/share";
    const sqlFiles = [
      ["information_schema.sql"],
      ["system_constraints.sql", "pg_catalog"],
      ["system_functions.sql", "pg_catalog"],
      ["system_views.sql", "pg_catalog"],
    ];
    // Load the sql files into the database
    for (const [file, schema] of sqlFiles) {
      const sql = await this.emp.FS.readFile(shareDir + "/" + file, {
        encoding: "utf8",
      });
      if (schema) {
        await this.#runExec(`SET search_path TO ${schema};\n ${sql}`);
      } else {
        await this.#runExec(sql);
      }
    }
    await this.#runExec(`
      SET search_path TO public;
      CREATE EXTENSION IF NOT EXISTS plpgsql;
    `);
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
    await new Promise<void>(async (resolve, reject) => {
      try {
        await this.execProtocol(serialize.end());
      } catch (e) {
        const err = e as { name: string; status: number };
        if (err.name === "ExitStatus" && err.status === 0) {
          resolve();
        } else {
          reject(e);
        }
      }
    });
    this.#closed = true;
    this.#closing = false;
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
    options?: QueryOptions,
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
    options?: QueryOptions,
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
          )),
          ...(await this.#execProtocolNoSync(
            serialize.bind({
              values: parsedParams.map(([val]) => val),
            }),
          )),
          ...(await this.#execProtocolNoSync(
            serialize.describe({ type: "P" }),
          )),
          ...(await this.#execProtocolNoSync(serialize.execute({}))),
        ];
      } finally {
        await this.#execProtocolNoSync(serialize.sync());
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
        blob,
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
    options?: QueryOptions,
  ): Promise<Array<Results>> {
    return await this.#queryMutex.runExclusive(async () => {
      // No params so we can just send the query
      this.#log("runExec", query, options);
      await this.#handleBlob(options?.blob);
      let results;
      try {
        results = await this.#execProtocolNoSync(serialize.query(query));
      } finally {
        await this.#execProtocolNoSync(serialize.sync());
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
        blob,
      ) as Array<Results>;
    });
  }

  /**
   * Execute a transaction
   * @param callback A callback function that takes a transaction object
   * @returns The result of the transaction
   */
  async transaction<T>(
    callback: (tx: Transaction) => Promise<T>,
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
            options?: QueryOptions,
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
   * Execute a postgres wire protocol message
   * @param message The postgres wire protocol message to execute
   * @returns The result of the query
   */
  async execProtocol(
    message: Uint8Array,
    { syncToFs = true }: ExecProtocolOptions = {},
  ): Promise<Array<[BackendMessage, Uint8Array]>> {
    return await this.#executeMutex.runExclusive(async () => {
      if (this.#resultAccumulator.length > 0) {
        this.#resultAccumulator = [];
      }

      var bytes = message.length;
      var ptr = this.emp._malloc(bytes);
      this.emp.HEAPU8.set(message, ptr);
      this.emp._ExecProtocolMsg(ptr);

      if (syncToFs) {
        await this.#syncToFs();
      }

      const resData = this.#resultAccumulator;

      const results: Array<[BackendMessage, Uint8Array]> = [];

      resData.forEach((data) => {
        this.#parser.parse(Buffer.from(data), (msg) => {
          if (msg instanceof DatabaseError) {
            this.#parser = new Parser(); // Reset the parser
            throw msg;
            // TODO: Do we want to wrap the error in a custom error?
          } else if (msg instanceof NoticeMessage && this.debug > 0) {
            // Notice messages are warnings, we should log them
            console.warn(msg);
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
      });

      return results;
    });
  }

  async #execProtocolNoSync(
    message: Uint8Array,
  ): Promise<Array<[BackendMessage, Uint8Array]>> {
    return await this.execProtocol(message, { syncToFs: false });
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
        await this.fs!.syncToFs(this.emp.FS);
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
      if (this.#notifyListeners.get(channel)!.size === 0) {
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
    callback: (channel: string, payload: string) => void,
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
}
