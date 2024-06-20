import { Mutex } from "async-mutex";
import EmPostgresFactory, { type EmPostgres } from "../release/postgres.js";
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
} from "./interface.js";

// Importing the source as the built version is not ESM compatible
import { serialize } from "pg-protocol/dist/index.js";
import { Parser } from "pg-protocol/dist/parser.js";
import {
  BackendMessage,
  DatabaseError,
  NoticeMessage,
  CommandCompleteMessage,
} from "pg-protocol/dist/messages.js";

export class PGlite implements PGliteInterface {
  fs?: Filesystem;
  protected emp?: any;

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

  #parser = new Parser();

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

    // Enable debug logging if requested
    if (options?.debug !== undefined) {
      this.debug = options.debug;
    }

    // Enable relaxed durability if requested
    if (options?.relaxedDurability !== undefined) {
      this.#relaxedDurability = options.relaxedDurability;
    }

    // Initialize the database, and store the promise so we can wait for it to be ready
    this.waitReady = this.#init(options ?? {});
  }

  /**
   * Initialize the database
   * @returns A promise that resolves when the database is ready
   */
  async #init(options: PGliteOptions) {

    console.log("options :", options)

    if (options.fs) {
      this.fs = options.fs;
    } else {
      const { dataDir, fsType } = parseDataDir(options.dataDir);
      this.fs = await loadFs(dataDir, fsType);
    }

    const args = [
      `PGDATA=/tmp/pglite/${this.fs.dataDir}`,
      "PREFIX=/tmp/pglite",
      "REPL=N",
      // "-F", // Disable fsync (TODO: Only for in-memory mode?)
      ...(this.debug ? ["-d", this.debug.toString()] : []),
    ];

    let emscriptenOpts: Partial<EmPostgres> = {
      arguments: args,
      noExitRuntime: true,
      ...(this.debug > 0
        ? { print: console.info, printErr: console.error }
        : { print: () => {}, printErr: () => {} }),
      locateFile: await makeLocateFile(),
    }

    emscriptenOpts = await this.fs!.emscriptenOpts(emscriptenOpts);
    //console.log("emscriptenOpts:", emscriptenOpts);

    // init pg core engine done only using MEMFS
    this.emp = await EmPostgresFactory(emscriptenOpts);

    // if ok, NOW:
    //   all pg c-api is avail. including exported sym

    console.warn("idbfs: mounting");
/*          this.emp.FS.mkdir("/tmp/pglite/base");
          this.emp.FS.mount(this.emp.FS.filesystems.IDBFS, {autoPersist: false}, '/tmp/pglite/base');
*/


    // finalize FS states needed before initdb.
    // maybe start extra FS/initdata async .

    console.error("syncing fs (idbfs->memfs)");
    await this.fs!.initialSyncFs(this.emp.FS);

    console.warn("idbfs: mounted");


    // start compiling dynamic extensions present in FS.

    console.log("database engine is ready (but not yet system/user databases or extensions)");


    // await async compilation dynamic extensions finished.

    // await extra FS/fetches.

    // await async compilation of fetched dynamic extensions.


    // bad things that could happen here :
    //  javascript host deny access to some FS
    //  FS is full
    //  FS is corrupted
    //  wasm compilation failed (eg missing features).
    //  a fetch has timeout.


    // if ok, NOW:
    // extensions used in user database are compiled (whatever their source).
    // FS hosting system indexes and user named db default "postgres" must be ready

    // -> if FS does not have a valid pgdata, initdb will run.

    const idb = this.emp._pg_initdb();

    if (!idb) {
      console.error("TODO: meaning full initdb return/error code ?");
    } else {
      if (idb & 0b0001)
        console.log(" #1");

      if (idb & 0b0010)
        console.log(" #2");

      if (idb & 0b0100)
        console.log(" #3");
    }


    console.log("database engine/system db are ready (maybe not user databases)");

    // extra FS could go here, same for sql init data.

    // eg custom SQL
    // eg read only database


    // bad things that could happen here :
    //  FS is corrupted
    //  something fetched is corrupted, not valid SQL.


    this.#ready = true;
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
      if (this.debug > 1) {
        console.log("runQuery", query, params, options);
      }
      const parsedParams = params?.map((p) => serializeType(p)) || [];
      let results;
      try {
        results = [
          ...(await this.#execProtocolNoSync(
            serialize.parse({
              text: query,
              types: parsedParams.map(([, type]) => type),
            })
          )),
          ...(await this.#execProtocolNoSync(
            serialize.bind({
              values: parsedParams.map(([val]) => val),
            })
          )),
          ...(await this.#execProtocolNoSync(
            serialize.describe({ type: "P" })
          )),
          ...(await this.#execProtocolNoSync(serialize.execute({}))),
        ];
      } finally {
        await this.#execProtocolNoSync(serialize.sync());
      }
      if (!this.#inTransaction) {
        await this.#syncToFs();
      }
      return parseResults(
        results.map(([msg]) => msg),
        options
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
      if (this.debug > 1) {
        console.log("runExec", query, options);
      }
      let results;
      try {
        results = await this.#execProtocolNoSync(serialize.query(query));
      } finally {
        await this.#execProtocolNoSync(serialize.sync());
      }
      if (!this.#inTransaction) {
        await this.#syncToFs();
      }
      return parseResults(
        results.map(([msg]) => msg),
        options
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
    { syncToFs = true }: ExecProtocolOptions = {}
  ): Promise<Array<[BackendMessage, Uint8Array]>> {
    return await this.#executeMutex.runExclusive(async () => {
      const msg_len = message.length;

      // >0 set buffer content type to wire protocol
      // set buffer size so answer will be at size+0x2 pointer addr
      this.emp._interactive_write(msg_len);

      // copy whole buffer at addr 0x1
      this.emp.HEAPU8.set(message, 1);

      // execute the message
      this.emp._interactive_one();

      if (syncToFs) {
        await this.#syncToFs();
      }

      const results: Array<[BackendMessage, Uint8Array]> = [];

      // Read responses from the buffer
      const msg_start = msg_len + 2;
      const msg_end = msg_start + this.emp._interactive_read();
      const data = this.emp.HEAPU8.subarray(msg_start, msg_end);

      this.#parser.parse(Buffer.from(data), (msg) => {
        console.log(msg)
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
        }
        results.push([msg, data]);
      });

      return results;
    });
  }

  async #execProtocolNoSync(
    message: Uint8Array
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
        console.warn("FS synced");
      });
    };

    if (this.#relaxedDurability) {
      doSync();
    } else {
      await doSync();
    }
  }
}
