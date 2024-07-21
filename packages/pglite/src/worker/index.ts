import * as Comlink from "comlink";
import type {
  DebugLevel,
  Extension,
  PGliteInterface,
  PGliteInterfaceExtensions,
  PGliteOptions,
  QueryOptions,
  Results,
  Transaction,
} from "../interface.js";
import type { BackendMessage } from "pg-protocol/dist/messages.js";

export class PGliteWorker implements PGliteInterface {
  readonly waitReady: Promise<void>;
  #debug: DebugLevel = 0;

  #ready = false;
  #closed = false;

  #worker: WorkerApi;
  #workerProcess: Worker;

  #notifyListeners = new Map<string, Set<(payload: string) => void>>();
  #globalNotifyListeners = new Set<
    (channel: string, payload: string) => void
  >();

  constructor(worker: Worker, options?: Pick<PGliteOptions, "extensions">) {
    this.#worker = Comlink.wrap(worker);
    this.#workerProcess = worker;
    this.waitReady = this.#init();
  }

  /**
   * Create a new PGlite instance with extensions on the Typescript interface
   * (The main constructor does enable extensions, however due to the limitations
   * of Typescript, the extensions are not available on the instance interface)
   * @param worker The worker to use
   * @param options Optional options
   * @returns A promise that resolves to the PGlite instance when it's ready.
   */
  static async create<O extends PGliteOptions>(
    worker: Worker,
    options?: O,
  ): Promise<PGliteWorker & PGliteInterfaceExtensions<O["extensions"]>> {
    const pg = new PGliteWorker(worker, options);
    await pg.waitReady;
    return pg as any;
  }

  async #init() {
    await new Promise((resolve) => {
      this.#workerProcess.addEventListener(
        "message",
        (event) => {
          if (event.data === "here") {
            resolve(undefined);
          }
        },
        { once: true },
      );
    });
    await this.#worker.init(
      Comlink.proxy(this.#receiveNotification.bind(this)),
    );
    this.#debug = await this.#worker.getDebugLevel();
    this.#ready = true;
  }

  get debug() {
    return this.#debug;
  }

  /**
   * The ready state of the database
   */
  get ready() {
    return this.#ready;
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
    await this.waitReady;
    await this.#worker.close();
    this.#closed = true;
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
    await this.waitReady;
    return this.#worker.query(query, params, options) as Promise<Results<T>>;
  }

  /**
   * Execute a SQL query, this can have multiple statements.
   * This uses the "Simple Query" postgres wire protocol message.
   * @param query The query to execute
   * @returns The result of the query
   */
  async exec(query: string, options?: QueryOptions): Promise<Array<Results>> {
    await this.waitReady;
    return this.#worker.exec(query, options);
  }

  /**
   * Execute a transaction
   * @param callback A callback function that takes a transaction object
   * @returns The result of the transaction
   */
  async transaction<T>(
    callback: (tx: Transaction) => Promise<T>,
  ): Promise<T | undefined> {
    await this.waitReady;
    const callbackProxy = Comlink.proxy(callback);
    return this.#worker.transaction(callbackProxy);
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
  async execProtocolRaw(message: Uint8Array): Promise<Uint8Array> {
    return this.#worker.execProtocolRaw(message);
  }

  /**
   * Execute a postgres wire protocol message
   * @param message The postgres wire protocol message to execute
   * @returns The result of the query
   */
  async execProtocol(
    message: Uint8Array,
  ): Promise<Array<[BackendMessage, Uint8Array]>> {
    await this.waitReady;
    return this.#worker.execProtocol(message);
  }

  /**
   * Listen for a notification
   * @param channel The channel to listen on
   * @param callback The callback to call when a notification is received
   */
  async listen(
    channel: string,
    callback: (payload: string) => void,
  ): Promise<() => Promise<void>> {
    await this.waitReady;
    if (!this.#notifyListeners.has(channel)) {
      this.#notifyListeners.set(channel, new Set());
    }
    this.#notifyListeners.get(channel)?.add(callback);
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
  async unlisten(
    channel: string,
    callback?: (payload: string) => void,
  ): Promise<void> {
    await this.waitReady;
    if (callback) {
      this.#notifyListeners.get(channel)?.delete(callback);
    } else {
      this.#notifyListeners.delete(channel);
    }
    if (this.#notifyListeners.get(channel)?.size === 0) {
      // As we currently have a dedicated worker we can just unlisten
      await this.exec(`UNLISTEN ${channel}`);
    }
  }

  /**
   * Listen to notifications
   * @param callback The callback to call when a notification is received
   */
  onNotification(callback: (channel: string, payload: string) => void) {
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

  #receiveNotification(channel: string, payload: string) {
    const listeners = this.#notifyListeners.get(channel);
    if (listeners) {
      for (const listener of listeners) {
        queueMicrotask(() => listener(payload));
      }
    }
    for (const listener of this.#globalNotifyListeners) {
      queueMicrotask(() => listener(channel, payload));
    }
  }

  async dumpDataDir() {
    return this.#worker.dumpDataDir();
  }
}

export const worker = {
  name: "PGliteWebWorker",
  setup: async (db: PGliteInterface, emscriptenOpts: any) => {
    return {
      namespaceObj: {
        start: async () => {
          const workerApi = makeWorkerApi(db);
          Comlink.expose(workerApi);
        },
      },
    };
  },
} satisfies Extension;

function makeWorkerApi(db: PGliteInterface) {
  const hereInterval = setInterval(() => {
    postMessage("here");
  }, 16);

  return {
    async init(onNotification?: (channel: string, payload: string) => void) {
      clearInterval(hereInterval);
      await db.waitReady;
      if (onNotification) {
        db.onNotification(onNotification);
      }
      return true;
    },
    async getDebugLevel() {
      return db.debug;
    },
    async close() {
      await db.close();
    },
    async query(query: string, params?: any[], options?: QueryOptions) {
      return await db.query(query, params, options);
    },
    async exec(query: string, options?: QueryOptions) {
      return await db.exec(query, options);
    },
    async transaction(callback: (tx: any) => Promise<any>) {
      return await db.transaction((tx) => {
        return callback(Comlink.proxy(tx));
      });
    },
    async execProtocol(message: Uint8Array) {
      return await db.execProtocol(message);
    },
    async execProtocolRaw(message: Uint8Array) {
      return await db.execProtocolRaw(message);
    },
    async dumpDataDir() {
      return await db.dumpDataDir();
    }
  };
}

type WorkerApi = ReturnType<typeof makeWorkerApi>;
