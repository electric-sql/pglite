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
import { uuid } from "../utils.js";
import type { BackendMessage } from "pg-protocol/dist/messages.js";

/*
TODO:
- Throw unresolved promises when the leader changes
- Implement notify
- Extensions
- Leader election events
*/

export class PGliteWorker implements PGliteInterface {
  #initPromise: Promise<void>;
  #debug: DebugLevel = 0;

  #ready = false;
  #closed = false;

  #eventTarget = new EventTarget();

  #tabId: string;

  #connected = false;

  #workerProcess: Worker;
  #workerID?: string;

  #broadcastChannel?: BroadcastChannel;
  #tabChannel?: BroadcastChannel;
  #releaseTabCloseLock?: () => void;

  #notifyListeners = new Map<string, Set<(payload: string) => void>>();
  #globalNotifyListeners = new Set<
    (channel: string, payload: string) => void
  >();

  constructor(worker: Worker, options?: Pick<PGliteOptions, "extensions">) {
    this.#workerProcess = worker;
    this.#tabId = uuid();
    this.#initPromise = this.#init();
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
    await pg.#initPromise;
    return pg as any;
  }

  async #init() {
    await new Promise<void>((resolve) => {
      this.#workerProcess.addEventListener(
        "message",
        (event) => {
          if (event.data.type === "here") {
            this.#workerID = event.data.id;
            resolve();
          }
        },
        { once: true },
      );
    });

    // Start the broadcast channel used to communicate with tabs and leader election
    const broadcastChannelId = `pglite-broadcast:${this.#workerID}`;
    this.#broadcastChannel = new BroadcastChannel(broadcastChannelId);

    // Start the tab channel used to communicate with the leader directly
    const tabChannelId = `pglite-tab:${this.#tabId}`;
    this.#tabChannel = new BroadcastChannel(tabChannelId);

    // Acquire the tab close lock, this is released then the tab is closed, or this
    // PGliteWorker instance is closed
    const tabCloseLockId = `pglite-tab-close:${this.#tabId}`;
    await new Promise<void>((resolve) => {
      navigator.locks.request(tabCloseLockId, () => {
        return new Promise<void>((release) => {
          resolve();
          this.#releaseTabCloseLock = release;
        });
      });
    });

    this.#broadcastChannel.addEventListener("message", async (event) => {
      if (event.data.type === "leader-here") {
        this.#connected = false;
        this.#leaderNotifyLoop();
      }
    });

    this.#tabChannel.addEventListener("message", async (event) => {
      if (event.data.type === "connected") {
        this.#connected = true;
        this.#eventTarget.dispatchEvent(new Event("connected"));
        this.#debug = await this.#rpc("getDebugLevel");
        this.#ready = true;
      }
    });

    this.#leaderNotifyLoop();
  }

  async #leaderNotifyLoop() {
    if (!this.#connected) {
      this.#broadcastChannel!.postMessage({
        type: "tab-here",
        id: this.#tabId,
      });
      setTimeout(() => this.#leaderNotifyLoop(), 16);
    }
  }

  async #rpc<Method extends WorkerRpcMethod>(
    method: Method,
    ...args: Parameters<WorkerApi[Method]>
  ): Promise<ReturnType<WorkerApi[Method]>> {
    const callId = uuid();
    this.#tabChannel!.postMessage({ type: "rpc-call", callId, method, args });
    return await new Promise<ReturnType<WorkerApi[Method]>>((resolve) => {
      const listener = (event: MessageEvent) => {
        if (event.data.type === "rpc-return" && event.data.callId === callId) {
          this.#tabChannel!.removeEventListener("message", listener);
          resolve(event.data.result);
        } else if (
          event.data.type === "rpc-error" &&
          event.data.callId === callId
        ) {
          this.#tabChannel!.removeEventListener("message", listener);
          const error = new Error(event.data.error.message);
          Object.assign(error, event.data.error);
          throw error;
        }
      };
      this.#tabChannel!.addEventListener("message", listener);
    });
  }

  get waitReady() {
    return new Promise<void>(async (resolve) => {
      await this.#initPromise;
      if (!this.#connected) {
        resolve(
          new Promise<void>((resolve) => {
            this.#eventTarget.addEventListener("connected", () => {
              resolve();
            });
          }),
        );
      } else {
        resolve();
      }
    });
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
    if (this.#closed) {
      return;
    }
    this.#closed = true;
    this.#broadcastChannel?.close();
    this.#tabChannel?.close();
    this.#releaseTabCloseLock?.();
    this.#workerProcess.terminate();
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
    return (await this.#rpc("query", query, params, options)) as Results<T>;
  }

  /**
   * Execute a SQL query, this can have multiple statements.
   * This uses the "Simple Query" postgres wire protocol message.
   * @param query The query to execute
   * @returns The result of the query
   */
  async exec(query: string, options?: QueryOptions): Promise<Array<Results>> {
    await this.waitReady;
    return (await this.#rpc("exec", query, options)) as Array<Results>;
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
    const txId = await this.#rpc("transactionStart");
    const ret = await callback({
      query: async (query, params, options) => {
        return await this.#rpc(
          "transactionQuery",
          txId,
          query,
          params,
          options,
        );
      },
      exec: async (query, options) => {
        return (await this.#rpc(
          "transactionExec",
          txId,
          query,
          options,
        )) as any;
      },
      rollback: async () => {
        await this.#rpc("transactionRollback", txId);
      },
      closed: false,
    } as Transaction);
    await this.#rpc("transactionCommit", txId);
    return ret;
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
    return (await this.#rpc("execProtocol", message)) as Array<
      [BackendMessage, Uint8Array]
    >;
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

export interface WorkerOptions {
  id?: string;
  init: () => Promise<PGliteInterface>;
}

export async function worker({ id, init }: WorkerOptions) {
  id = id ?? import.meta.url;

  const electionLockId = `pglite-election-lock:${id}`;
  const broadcastChannelId = `pglite-broadcast:${id}`;
  const broadcastChannel = new BroadcastChannel(broadcastChannelId);
  const connectedTabs = new Set<string>();

  // Send a message to the main thread to let it know we are here
  postMessage({ type: "here", id });

  // Await the main lock which is used to elect the leader
  await new Promise<void>((resolve) => {
    navigator.locks.request(electionLockId, () => {
      return new Promise((_releaseLock) => {
        // This is now the leader!
        // We don't release the load by resolving the promise
        // It will be released when the worker is closed
        resolve();
      });
    });
  });

  // Now we are the leader, start the worker
  const dbPromise = init();

  // Start listening for messages from tabs
  broadcastChannel.onmessage = async (event) => {
    const msg = event.data;
    switch (msg.type) {
      case "tab-here":
        // A new tab has joined,
        connectTab(msg.id, await dbPromise, connectedTabs);
        break;
    }
  };

  // Notify the other tabs that we are the leader
  broadcastChannel.postMessage({ type: "leader-here", id });
}

function connectTab(
  tabId: string,
  pg: PGliteInterface,
  connectedTabs: Set<string>,
) {
  if (connectedTabs.has(tabId)) {
    return;
  }
  connectedTabs.add(tabId);
  const tabChannelId = `pglite-tab:${tabId}`;
  const tabCloseLockId = `pglite-tab-close:${tabId}`;
  const tabChannel = new BroadcastChannel(tabChannelId);

  // Use a tab close lock to unsubscribe the tab
  navigator.locks.request(tabCloseLockId, () => {
    return new Promise<void>((resolve) => {
      // The tab has been closed, unsubscribe the tab broadcast channel
      tabChannel.close();
      connectedTabs.delete(tabId);
      resolve();
    });
  });

  const api = makeWorkerApi(pg);

  tabChannel.addEventListener("message", async (event) => {
    const msg = event.data;
    switch (msg.type) {
      case "rpc-call":
        const { callId, method, args } = msg as WorkerRpcCall<WorkerRpcMethod>;
        try {
          // @ts-ignore
          const result = await api[method](...args);
          tabChannel.postMessage({ type: "rpc-return", callId, result });
        } catch (error) {
          tabChannel.postMessage({ type: "rpc-error", callId, error });
        }
        break;
    }
  });

  // Send a message to the tab to let it know it's connected
  tabChannel.postMessage({ type: "connected" });
}

function makeWorkerApi(db: PGliteInterface) {
  const transactions = new Map<
    string,
    {
      tx: Transaction;
      resolve: () => void;
      reject: (error: any) => void;
    }
  >();

  return {
    async init() {
      await db.waitReady;
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
    async transactionStart() {
      const txId = uuid();
      db.transaction((newTx) => {
        return new Promise<void>((resolveTx, rejectTx) => {
          transactions.set(txId, {
            tx: newTx,
            resolve: resolveTx,
            reject: rejectTx,
          });
        });
      });
      return txId;
    },
    async transactionCommit(id: string) {
      if (!transactions.has(id)) {
        throw new Error("No transaction");
      }
      transactions.get(id)!.resolve();
      transactions.delete(id);
    },
    async transactionQuery<T>(
      id: string,
      query: string,
      params?: any[],
      options?: QueryOptions,
    ) {
      if (!transactions.has(id)) {
        throw new Error("No transaction");
      }
      return await transactions.get(id)!.tx.query<T>(query, params, options);
    },
    async transactionExec(id: string, query: string, options?: QueryOptions) {
      if (!transactions.has(id)) {
        throw new Error("No transaction");
      }
      return await transactions.get(id)!.tx.exec(query, options);
    },
    async transactionRollback(id: string) {
      if (!transactions.has(id)) {
        throw new Error("No transaction");
      }
      await transactions.get(id)!.tx.rollback();
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

type WorkerRpcMethod = keyof WorkerApi;

type WorkerRpcCall<Method extends WorkerRpcMethod> = {
  type: "rpc-call";
  callId: string;
  method: Method;
  args: Parameters<WorkerApi[Method]>;
};

type WorkerRpcReturn<Method extends WorkerRpcMethod> = {
  type: "rpc-return";
  callId: string;
  result: ReturnType<WorkerApi[Method]>;
};

type WorkerRpcError = {
  type: "rpc-error";
  callId: string;
  error: any;
};
