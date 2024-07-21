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
import { uuid } from "../utils.js";
import type { BackendMessage } from "pg-protocol/dist/messages.js";

export class PGliteWorker implements PGliteInterface {
  #initPromise: Promise<void>;
  #debug: DebugLevel = 0;

  #ready = false;
  #closed = false;

  #eventTarget = new EventTarget();

  #tabId: string;

  #leader?: WorkerApi;
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
    options?: O
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
        { once: true }
      );
    });
    console.log("Worker ID", this.#workerID);

    // Start the broadcast channel used to communicate with tabs and leader election
    const broadcastChannelId = `pglite-broadcast:${this.#workerID}`;
    this.#broadcastChannel = new BroadcastChannel(broadcastChannelId);

    // Start the tab channel used to communicate with the leader directly
    const tabChannelId = `pglite-tab:${this.#tabId}`;
    this.#tabChannel = new BroadcastChannel(tabChannelId);

    console.log(0);

    // Acquire the tab close lock, this is released then the tab is closed, or this
    // PGliteWorker instance is closed
    const tabCloseLockId = `pglite-tab-close:${this.#tabId}`;
    await new Promise<void>((resolve) => {
      navigator.locks.request(tabCloseLockId, () => {
        console.log("A");
        return new Promise<void>((release) => {
          resolve();
          console.log("B");
          this.#releaseTabCloseLock = release;
        });
      });
    });
    console.log(1);

    this.#leader = Comlink.wrap(this.#tabChannel);

    this.#broadcastChannel.addEventListener("message", async (event) => {
      if (event.data.type === "leader-here") {
        console.log("+ leader here", event.data.id);
        this.#connected = false;
        this.#leaderNotifyLoop();
      }
    });

    this.#tabChannel.addEventListener("message", async (event) => {
      if (event.data.type === "connected") {
        console.log("+ connected");
        this.#connected = true;
        this.#eventTarget.dispatchEvent(new Event("connected"));
        this.#debug = await this.#leader!.getDebugLevel();
        this.#ready = true;
        console.log("ready", this.#initPromise, this.waitReady);
      }
    });

    console.log(2);

    this.#leaderNotifyLoop();
  }

  async #leaderNotifyLoop() {
    if (!this.#connected) {
      console.log("+ notify leader tab-here");
      this.#broadcastChannel!.postMessage({
        type: "tab-here",
        id: this.#tabId,
      });
      setTimeout(() => this.#leaderNotifyLoop(), 16);
    }
  }

  get waitReady() {
    return new Promise<void>(async (resolve) => {
      console.log("-a");
      await this.#initPromise;
      if (!this.#connected) {
        console.log("-b");
        resolve(new Promise<void>((resolve) => {
          this.#eventTarget.addEventListener("connected", () => {
            console.log("connected!!!!");
            resolve();
          });
        }));
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
    options?: QueryOptions
  ): Promise<Results<T>> {
    await this.waitReady;
    return this.#leader!.query(query, params, options) as Promise<Results<T>>;
  }

  /**
   * Execute a SQL query, this can have multiple statements.
   * This uses the "Simple Query" postgres wire protocol message.
   * @param query The query to execute
   * @returns The result of the query
   */
  async exec(query: string, options?: QueryOptions): Promise<Array<Results>> {
    console.log('+++++', this.waitReady);
    await this.waitReady;
    console.log("exec", query);
    return this.#leader!.exec(query, options);
  }

  /**
   * Execute a transaction
   * @param callback A callback function that takes a transaction object
   * @returns The result of the transaction
   */
  async transaction<T>(
    callback: (tx: Transaction) => Promise<T>
  ): Promise<T | undefined> {
    await this.waitReady;
    const callbackProxy = Comlink.proxy(callback);
    return this.#leader!.transaction(callbackProxy);
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
    message: Uint8Array
  ): Promise<Array<[BackendMessage, Uint8Array]>> {
    await this.waitReady;
    return this.#leader!.execProtocol(message);
  }

  /**
   * Listen for a notification
   * @param channel The channel to listen on
   * @param callback The callback to call when a notification is received
   */
  async listen(
    channel: string,
    callback: (payload: string) => void
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
    callback?: (payload: string) => void
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

  console.log("- leader here");

  // Now we are the leader, start the worker
  const dbPromise = init();

  // Start listening for messages from tabs
  broadcastChannel.onmessage = async (event) => {
    const msg = event.data;
    switch (msg.type) {
      case "tab-here":
        // A new tab has joined,
        console.log("- tab here", msg.id);
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
  connectedTabs: Set<string>
) {
  console.log(0)
  if (connectedTabs.has(tabId)) {
    return;
  }
  connectedTabs.add(tabId);
  console.log(1)
  const tabChannelId = `pglite-tab:${tabId}`;
  const tabCloseLockId = `pglite-tab-close:${tabId}`;
  const tabChannel = new BroadcastChannel(tabChannelId);
  Comlink.expose(makeWorkerApi(pg), tabChannel);
  console.log(2)

  // Use a tab close lock to unsubscribe the tab
  navigator.locks.request(tabCloseLockId, () => {
    return new Promise<void>((resolve) => {
      // The tab has been closed, unsubscribe the tab broadcast channel
      tabChannel.close();
      connectedTabs.delete(tabId);
      resolve();
    });
  });

  console.log("- let tab know its connected", tabId);
  // Send a message to the tab to let it know it's connected
  tabChannel.postMessage({ type: "connected" });
}

function makeWorkerApi(db: PGliteInterface) {
  return {
    async init(onNotification?: (channel: string, payload: string) => void) {
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
