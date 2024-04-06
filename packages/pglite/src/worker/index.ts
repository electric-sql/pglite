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

const WORKER_URL = new URL("./process.js", import.meta.url);

export class PGliteWorker implements PGliteInterface {
  readonly dataDir?: string;
  readonly fsType: FilesystemType;
  readonly waitReady: Promise<void>;
  readonly debug: DebugLevel = 0;

  #ready = false;
  #closed = false;

  #worker: WorkerInterface;

  constructor(dataDir: string, options?: PGliteOptions) {
    const { dataDir: dir, fsType } = parseDataDir(dataDir);
    this.dataDir = dir;
    this.fsType = fsType;
    this.debug = options?.debug ?? 0;

    this.#worker = Comlink.wrap(new Worker(WORKER_URL, { type: "module" }));

    // pass unparsed dataDir value
    this.waitReady = this.#init(dataDir);
  }

  async #init(dataDir: string) {
    await this.#worker.init(dataDir, { debug: this.debug });
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
}
