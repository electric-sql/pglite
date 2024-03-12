import { Mutex } from "async-mutex";
import EmPostgresFactory, { type EmPostgres } from "../release/postgres.js";
import type { Filesystem } from "./fs.js";
import { MemoryFS } from "./memoryfs.js";
import { IdbFs } from "./idbfs.js";
import { nodeValues } from "./utils.js";
import { PGEvent } from "./pg-event.js";
import { parseResults } from "./parse.js";

// Importing the source as the built version is not ESM compatible
import { serialize } from "pg-protocol/src/index.js";
import { Parser } from "pg-protocol/src/parser.js";
import { BackendMessage } from "pg-protocol/src/messages.js";

export { Mutex, serialize };
export * from "pg-protocol/src/messages.js";

const PGWASM_URL = new URL("../release/postgres.wasm", import.meta.url);
const PGSHARE_URL = new URL("../release/share.data", import.meta.url);

type FilesystemType = "nodefs" | "idbfs" | "memoryfs";

export type DebugLevel = 0 | 1 | 2 | 3 | 4 | 5;

export interface PGliteOptions {
  debug?: DebugLevel;
}

export class PGlite {
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
  #awaitingResult = false;
  #resultError?: string;

  waitReady: Promise<void>;

  #executeMutex = new Mutex();
  #queryMutex = new Mutex();
  #transactionMutex = new Mutex();
  #fsSyncMutex = new Mutex();

  debug: DebugLevel = 0;

  #parser = new Parser();

  /**
   * Create a new PGlite instance
   * @param dataDir The directory to store the database files
   *                Prefix with idb:// to use indexeddb filesystem in the browser
   *                Use memory:// to use in-memory filesystem
   * @param options Optional options
   */
  constructor(dataDir?: string, options?: PGliteOptions) {
    if (dataDir?.startsWith("file://")) {
      // Remove the file:// prefix, and use node filesystem
      this.dataDir = dataDir.slice(7);
      if (!this.dataDir) {
        throw new Error("Invalid dataDir, must be a valid path");
      }
      this.fsType = "nodefs";
    } else if (dataDir?.startsWith("idb://")) {
      // Remove the idb:// prefix, and use indexeddb filesystem
      this.dataDir = dataDir.slice(6);
      if (!this.dataDir.startsWith("/")) {
        this.dataDir = "/" + this.dataDir;
      }
      if (this.dataDir.length <= 1) {
        throw new Error("Invalid dataDir, path required for idbfs");
      }
      this.fsType = "idbfs";
    } else if (!dataDir || dataDir?.startsWith("memory://")) {
      // Use in-memory filesystem
      this.fsType = "memoryfs";
    } else {
      // No prefix, use node filesystem
      this.dataDir = dataDir;
      this.fsType = "nodefs";
    }

    // Enable debug logging if requested
    if (options?.debug) {
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
    return new Promise<void>(async (resolve, reject) => {
      if (this.#initStarted) {
        throw new Error("Already initializing");
      }
      this.#initStarted = true;

      if (this.dataDir && this.fsType === "nodefs") {
        const { NodeFS } = await import("./nodefs.js");
        this.fs = new NodeFS(this.dataDir);
      } else if (this.dataDir && this.fsType === "idbfs") {
        this.fs = new IdbFs(this.dataDir);
      } else {
        this.fs = new MemoryFS();
      }
      await this.fs.init(this.debug);

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
        ...(this.debug
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

      const { dirname, require } = await nodeValues();
      emscriptenOpts = await this.fs.emscriptenOpts(emscriptenOpts);
      const emp = await EmPostgresFactory(emscriptenOpts, dirname, require);
      this.emp = emp;
    });
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
  close() {
    this.#closing = true;
    const promise = new Promise((resolve, reject) => {
      this.#eventTarget.addEventListener("closed", resolve, {
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
  async query<T>(query: string, params?: any[]): Promise<Results<T>> {
    // We wrap the public query method in the transaction mutex to ensure that
    // only one query can be executed at a time and not concurrently with a
    // transaction.
    return await this.#transactionMutex.runExclusive(async () => {
      return await this.#runQuery<T>(query, params);
    });
  }

  /**
   * Execute a SQL query, this can have multiple statements.
   * This uses the "Simple Query" postgres wire protocol message.
   * @param query The query to execute
   * @returns The result of the query
   */
  async exec(query: string): Promise<Array<Results>> {
    // We wrap the public exec method in the transaction mutex to ensure that
    // only one query can be executed at a time and not concurrently with a
    // transaction.
    return await this.#transactionMutex.runExclusive(async () => {
      return await this.#runExec(query);
    });
  }

  /**
   * Internal method to execute a query
   * Not protected by the transaction mutex, so it can be used inside a transaction
   * @param query The query to execute
   * @param params Optional parameters for the query
   * @returns The result of the query
   */
  async #runQuery<T>(query: string, params?: any[]): Promise<Results<T>> {
    return await this.#queryMutex.runExclusive(async () => {
      // We need to parse, bind and execute a query with parameters
      const results = [
        ...await this.execProtocol(
          serialize.parse({
            text: query,
          })
        ),
        ...await this.execProtocol(
          serialize.bind({
            values: params,
          })
        ),
        ...await this.execProtocol(serialize.execute({})),
        ...await this.execProtocol(serialize.sync()),
      ];
      return parseResults(results.map(([msg]) => msg))[0] as Results<T>;
    });
  }

  /**
   * Internal method to execute a query
   * Not protected by the transaction mutex, so it can be used inside a transaction
   * @param query The query to execute
   * @param params Optional parameters for the query
   * @returns The result of the query
   */
  async #runExec(query: string): Promise<Array<Results>> {
    return await this.#queryMutex.runExclusive(async () => {
      // No params so we can just send the query
      const results = [
        ...await this.execProtocol(serialize.query(query)),
        // ...await this.execProtocol(serialize.sync()),
      ]
      return parseResults(results.map(([msg]) => msg)) as Array<Results>;
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
    return await this.#transactionMutex.runExclusive(async () => {
      await this.query("BEGIN");
      try {
        const tx: Transaction = {
          query: async (query: string, params?: any[]) => {
            return await this.#runQuery(query, params);
          },
          exec: async (query: string) => {
            return await this.#runExec(query);
          },
          rollback: () => {
            throw new Rollback();
          },
        };
        const result = await callback(tx);
        await this.query("COMMIT");
        return result;
      } catch (e) {
        await this.query("ROLLBACK");
        if (e instanceof Rollback) {
          return; // Rollback was called, so we return undefined (TODO: is this the right thing to do?)
        } else {
          throw e;
        }
      }
    });
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
      if (this.#resultAccumulator.length > 0) {
        this.#resultAccumulator = [];
      }

      const resData: Array<Uint8Array> = await new Promise(
        async (resolve, reject) => {
          this.#awaitingResult = true;
          const handleWaiting = async () => {
            await this.#syncToFs();
            if (this.#resultError) {
              reject(new Error(this.#resultError));
            } else {
              resolve(this.#resultAccumulator);
            }
            this.#resultAccumulator = [];
            this.#resultError = undefined;
            this.#awaitingResult = false;
          };

          this.#eventTarget.addEventListener("waiting", handleWaiting, {
            once: true,
          });

          const event = new PGEvent("query", {
            detail: message,
          });
          this.#eventTarget.dispatchEvent(event);
        }
      );

      const results = resData.map((data) => {
        let message: BackendMessage | undefined;
        this.#parser.parse(Buffer.from(data), (mgs) => {
          message = mgs;
        });
        return [message, data] as [BackendMessage, Uint8Array];
      });

      // TODO: handle any error message here

      // TODO: handle any notify message here
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

export type Row<T = { [key: string]: any }> = T;

export type Results<T = { [key: string]: any }> = {
  rows: Row<T>[];
  affectedRows?: number;
  fields: { name: string; dataTypeID: number }[];
  command?: string;
};

export interface Transaction {
  query<T>(query: string, params?: any[]): Promise<Results<T>>;
  exec(query: string): Promise<Array<Results>>;
  rollback(): void;
}

/**
 * An error that can be thrown to rollback a transaction
 */
class Rollback extends Error {
  constructor() {
    super("Rollback");
  }
}
