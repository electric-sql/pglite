import { Mutex } from "async-mutex";
import EmPostgresFactory, { type EmPostgres } from "../release/postgres.js";
import type { Filesystem } from "./fs.js";
import { MemoryFS } from "./memoryfs.js";
import { IdbFs } from "./idbfs.js";
import { nodeValues } from "./utils.js";

type FilesystemType = "nodefs" | "idbfs" | "memoryfs";

export class PGlite {
  readonly dataDir?: string;
  readonly fsType: FilesystemType;
  protected fs?: Filesystem;
  protected emp?: any;

  #initStarted = false;
  #ready = false;
  #eventTarget: EventTarget;
  #closed = false;

  #awaitingResult = false;
  #resultError?: string;

  waitReady: Promise<void>;

  #queryMutex = new Mutex();
  #fsSyncMutex = new Mutex();

  constructor(dataDir?: string) {
    if (dataDir?.startsWith("file://")) {
      this.dataDir = dataDir.slice(7);
      if (!this.dataDir) {
        throw new Error("Invalid dataDir, must be a valid path");
      }
      this.fsType = "nodefs";
    } else if (dataDir?.startsWith("idb://")) {
      this.dataDir = dataDir.slice(6);
      if (!this.dataDir.startsWith("/")) {
        this.dataDir = "/" + this.dataDir;
      }
      if (this.dataDir.length <= 1) {
        throw new Error("Invalid dataDir, path required for idbfs");
      }
      this.fsType = "idbfs";
    } else if (!dataDir || dataDir?.startsWith("memory://")) {
      this.fsType = "memoryfs";
    } else {
      this.dataDir = dataDir;
      this.fsType = "nodefs";
    }

    this.#eventTarget = new EventTarget();
    this.waitReady = this.#init();
  }

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
      await this.fs.init();

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
          "-d", // Debug level
          "0",
          "-D", // Data directory
          "/pgdata",
          "template1",
        ],
        print: (text: string) => {
          // console.info(text);
        },
        printErr: (text: string) => {
          if (
            this.#awaitingResult &&
            !this.#resultError &&
            text.includes("ERROR:")
          ) {
            this.#resultError = text.split("ERROR:")[1].trim();
          }
          // console.error(text);
        },
        onRuntimeInitialized: async (Module: EmPostgres) => {
          await this.fs!.initialSyncFs(Module.FS);
          this.#ready = true;
          resolve();
        },
        eventTarget: this.#eventTarget,
        Event: CustomEvent,
      };

      const { dirname, require } = await nodeValues();
      emscriptenOpts = await this.fs.emscriptenOpts(emscriptenOpts);
      const emp = await EmPostgresFactory(emscriptenOpts, dirname, require);
      this.emp = emp;
    });
  }

  get ready() {
    return this.#ready;
  }

  get closed() {
    return this.#closed;
  }

  async close() {
    const event = new CustomEvent("query", {
      detail: {
        query: "",
        qtype: "X",
      },
    });
    this.#eventTarget.dispatchEvent(event);
    this.#closed = true;
  }

  async query(query: String) {
    /**
     * TODO:
     * - Support for parameterized queries
     */
    if (this.#closed) {
      throw new Error("Postgreslite is closed");
    }
    if (!this.#ready) {
      await this.waitReady;
    }
    return new Promise(async (resolve, reject) => {
      await this.#queryMutex.runExclusive(async () => {
        this.#awaitingResult = true;
        const handleWaiting = async () => {
          await this.#syncToFs();
          this.#eventTarget.removeEventListener("result", handleResult);
          if (this.#resultError) {
            reject(new Error(this.#resultError));
          } else {
            resolve(undefined);
          }
          this.#resultError = undefined;
          this.#awaitingResult = false;
        };

        const handleResult = async (e: any) => {
          await this.#syncToFs();
          this.#eventTarget.removeEventListener("waiting", handleWaiting);
          resolve(e.detail.result);
          this.#resultError = undefined;
          this.#awaitingResult = false;
        };

        this.#eventTarget.addEventListener("waiting", handleWaiting, {
          once: true,
        });
        this.#eventTarget.addEventListener("result", handleResult, {
          once: true,
        });

        const event = new CustomEvent("query", {
          detail: {
            query: query,
          },
        });
        this.#eventTarget.dispatchEvent(event);
      });
    });
  }

  async #syncToFs() {
    await this.#fsSyncMutex.runExclusive(async () => {
      await this.fs!.syncToFs(this.emp.FS);
    });
  }
}
