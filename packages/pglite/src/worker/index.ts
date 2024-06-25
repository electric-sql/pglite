import * as Comlink from "comlink";
import type {
  PGliteInterface,
  PGliteOptions,
  FilesystemType,
  DebugLevel,
  Results,
  QueryOptions,
} from "../interface.js";
import type { BackendMessage } from "pg-protocol/dist/messages.js";
import { parseDataDir } from "../fs/index.js";
import type { Worker as WorkerInterface } from "./process.js";

export class PGliteWorker implements PGliteInterface {
  readonly dataDir?: string;
  readonly fsType: FilesystemType;
  readonly waitReady: Promise<void>;
  readonly debug: DebugLevel = 0;

  #ready = false;
  #closed = false;

  #worker: WorkerInterface;
  #options: PGliteOptions;

  #notifyListeners = new Map<string, Set<(payload: string) => void>>();
  #globalNotifyListeners = new Set<
    (channel: string, payload: string) => void
  >();

  constructor(dataDir: string, options?: PGliteOptions) {
    const { dataDir: dir, fsType } = parseDataDir(dataDir);
    this.dataDir = dir;
    this.fsType = fsType;
    this.#options = options ?? {};
    this.debug = options?.debug ?? 0;

    this.#worker = Comlink.wrap(
      // the below syntax is required by webpack in order to
      // identify the worker properly during static analysis
      // see: https://webpack.js.org/guides/web-workers/
      new Worker(new URL("./process.js", import.meta.url), { type: "module" }),
    );

    // pass unparsed dataDir value
    this.waitReady = this.#init(dataDir);
  }

  async #init(dataDir: string) {
    await this.#worker.init(
      dataDir,
      this.#options,
      Comlink.proxy(this.receiveNotification.bind(this)),
    );
    this.#ready = true;
  }

  get ready() {
    return this.#ready;
  }

  get closed() {
    return this.#closed;
  }

  async close() {
    await this.#worker.close();
    this.#closed = true;
  }

  async query<T>(
    query: string,
    params?: any[],
    options?: QueryOptions,
  ): Promise<Results<T>> {
    return this.#worker.query(query, params, options) as Promise<Results<T>>;
  }

  async exec(query: string, options?: QueryOptions): Promise<Array<Results>> {
    return this.#worker.exec(query, options);
  }

  async transaction<T>(callback: (tx: any) => Promise<T>) {
    const callbackProxy = Comlink.proxy(callback);
    return this.#worker.transaction(callbackProxy);
  }

  async execProtocol(
    message: Uint8Array,
  ): Promise<Array<[BackendMessage, Uint8Array]>> {
    return this.#worker.execProtocol(message);
  }

  async listen(
    channel: string,
    callback: (payload: string) => void,
  ): Promise<() => Promise<void>> {
    if (!this.#notifyListeners.has(channel)) {
      this.#notifyListeners.set(channel, new Set());
    }
    this.#notifyListeners.get(channel)?.add(callback);
    await this.exec(`LISTEN ${channel}`);
    return async () => {
      await this.unlisten(channel, callback);
    };
  }

  async unlisten(
    channel: string,
    callback?: (payload: string) => void,
  ): Promise<void> {
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

  onNotification(callback: (channel: string, payload: string) => void) {
    this.#globalNotifyListeners.add(callback);
    return () => {
      this.#globalNotifyListeners.delete(callback);
    };
  }

  offNotification(callback: (channel: string, payload: string) => void) {
    this.#globalNotifyListeners.delete(callback);
  }

  receiveNotification(channel: string, payload: string) {
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
}
