import { Mutex } from "async-mutex";
import EmPostgresFactory, { type EmPostgres } from "../release/postgres.js";
import { type Filesystem, parseDataDir, loadFs } from "./fs/index.js";
import { nodeValues } from "./utils.js";
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
} from "./interface.js";

// Importing the source as the built version is not ESM compatible
import { serialize } from "pg-protocol/dist/index.js";
import { Parser } from "pg-protocol/dist/parser.js";
import {
  BackendMessage,
  DatabaseError,
  NoticeMessage,
} from "pg-protocol/dist/messages.js";

const PGWASM_URL = new URL("../release/postgres.wasm", import.meta.url);
const PGSHARE_URL = new URL("../release/share.data", import.meta.url);

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

  #resultAccumulator: Uint8Array[] = [];

  readonly waitReady: Promise<void>;

  #executeMutex = new Mutex();
  #queryMutex = new Mutex();
  #transactionMutex = new Mutex();
  #fsSyncMutex = new Mutex();

  readonly debug: DebugLevel = 0;

  #parser = new Parser();

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
        locateFile: (base: string, _path: any) => {
          let path = "";
          if (base === "share.data") {
            path = PGSHARE_URL.toString();
          } else if (base === "postgres.wasm") {
            path = PGWASM_URL.toString();
          }
          if (path?.startsWith("file://")) {
            path = path.slice(7);
          }
          return path;
        },
        ...(this.debug > 0
          ? { print: console.info, printErr: console.error }
          : { print: () => {}, printErr: () => {} }),
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
      CREATE EXTENSION IF NOT EXISTS plpgsql;
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
    const promise = new Promise<void>((resolve, reject) => {
      this.#eventTarget.addEventListener("closed", () => resolve(), {
        once: true,
      });
    });
    this.execProtocol(serialize.end());
    // TODO: handel settings this.#closed = true and this.#closing = false;
    // TODO: silence the unhandled promise rejection warning
    return promise;
  }

  /**
   * Execute a single SQL statement
   * This uses the "Extended Query" postgres wire protocol message.
   * @param query The query to execute
   * @param params Optional parameters for the query
   * @returns The result of the query
   */
  async query<T>(query: string, params?: any[], options?: QueryOptions): Promise<Results<T>> {
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
  async #runQuery<T>(query: string, params?: any[], options?: QueryOptions): Promise<Results<T>> {
    return await this.#queryMutex.runExclusive(async () => {
      // We need to parse, bind and execute a query with parameters
      const parsedParams = params?.map((p) => serializeType(p)) || [];
      let results;
      try {
        results = [
          ...(await this.execProtocol(
            serialize.parse({
              text: query,
              types: parsedParams.map(([, type]) => type),
            })
          )),
          ...(await this.execProtocol(
            serialize.bind({
              values: parsedParams.map(([val]) => val),
            })
          )),
          ...(await this.execProtocol(serialize.describe({ type: "P" }))),
          ...(await this.execProtocol(serialize.execute({}))),
        ];
      } finally {
        await this.execProtocol(serialize.sync());
      }
      return parseResults(results.map(([msg]) => msg), options)[0] as Results<T>;
    });
  }

  /**
   * Internal method to execute a query
   * Not protected by the transaction mutex, so it can be used inside a transaction
   * @param query The query to execute
   * @param params Optional parameters for the query
   * @returns The result of the query
   */
  async #runExec(query: string, options?: QueryOptions): Promise<Array<Results>> {
    return await this.#queryMutex.runExclusive(async () => {
      // No params so we can just send the query
      let results;
      try {
        results = await this.execProtocol(serialize.query(query));
      } finally {
        await this.execProtocol(serialize.sync());
      }
      return parseResults(results.map(([msg]) => msg), options) as Array<Results>;
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
          query: async (query: string, params?: any[], options?: QueryOptions) => {
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
    message: Uint8Array
  ): Promise<Array<[BackendMessage, Uint8Array]>> {
    return await this.#executeMutex.runExclusive(async () => {
      if (this.#resultAccumulator.length > 0) {
        this.#resultAccumulator = [];
      }

      var bytes = message.length;
      var ptr = this.emp._malloc(bytes);
      this.emp.HEAPU8.set(message, ptr);
      this.emp._ExecProtocolMsg(ptr);

      await this.#syncToFs();
      const resData = this.#resultAccumulator;

      const results: Array<[BackendMessage, Uint8Array]> = [];

      resData.forEach((data) => {
        this.#parser.parse(Buffer.from(data), (msg) => {
          if (msg instanceof DatabaseError) {
            this.#parser = new Parser(); // Reset the parser
            throw msg;
            // TODO: Do we want to wrap the error in a custom error?
          } else if (msg instanceof NoticeMessage) {
            // Notice messages are warnings, we should log them
            console.warn(msg);
          }
          results.push([msg, data]);
        });
      });

      return results;
    });
  }

  /**
   * Perform any sync operations implemented by the filesystem, this is
   * run after every query to ensure that the filesystem is synced.
   */
  async #syncToFs() {
    await this.#fsSyncMutex.runExclusive(async () => {
      await this.fs!.syncToFs(this.emp.FS);
    });
  }
}
