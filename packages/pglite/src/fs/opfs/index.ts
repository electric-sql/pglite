import { FilesystemBase } from "../types.js";
import { PGDATA } from "../index.js";
import type { PostgresMod, FS } from "../../postgres.js";
import { createOPFS } from "./opfs-worker.js";
import { SyncOPFS } from "./syncOpfs/index.js";
import { createOPFSAHP } from "./opfs-ahp.js";
import { OpfsAhp } from "./opfsAhp/index.js";

export class Opfs extends FilesystemBase {
  constructor(dataDir: string) {
    super(dataDir);
  }

  async emscriptenOpts(opts: Partial<PostgresMod>) {
    const syncOPFS = await SyncOPFS.create();
    const options: Partial<PostgresMod> = {
      ...opts,
      preRun: [
        ...(opts.preRun || []),
        (mod: PostgresMod) => {
          syncOPFS.mkdir(this.dataDir!, { recursive: true });
          const OPFS = createOPFS(mod, syncOPFS);
          mod.FS.mkdir(PGDATA);
          mod.FS.mount(
            OPFS,
            {
              root: this.dataDir!,
            },
            PGDATA
          );
        },
      ],
    };
    return options;
  }
}

export interface OpfsAhpFSOptions {
  initialPoolSize?: number;
  maintainedPoolSize?: number;
}

export class OpfsAhpFS extends FilesystemBase {
  #initialPoolSize: number;
  #maintainedPoolSize: number;
  opfsAhp?: OpfsAhp;

  constructor(
    dataDir: string,
    { initialPoolSize, maintainedPoolSize }: OpfsAhpFSOptions = {}
  ) {
    super(dataDir);
    this.#initialPoolSize = initialPoolSize ?? 1000;
    this.#maintainedPoolSize = maintainedPoolSize ?? 100;
  }

  async emscriptenOpts(opts: Partial<PostgresMod>) {
    this.opfsAhp = await OpfsAhp.create({
      root: this.dataDir!,
      initialPoolSize: this.#initialPoolSize,
      maintainedPoolSize: this.#maintainedPoolSize,
    });
    const options: Partial<PostgresMod> = {
      ...opts,
      preRun: [
        ...(opts.preRun || []),
        (mod: PostgresMod) => {
          const OPFS = createOPFSAHP(mod, this.opfsAhp!);
          mod.FS.mkdir(PGDATA);
          mod.FS.mount(OPFS, {}, PGDATA);
        },
      ],
    };
    return options;
  }

  async syncToFs(fs: FS, relaxedDurability = false) {
    await this.opfsAhp?.maybeCheckpointState();
    await this.opfsAhp?.maintainPool();
    // console.log("syncToFs", relaxedDurability);
    if (!relaxedDurability) {
      this.opfsAhp?.flush();
    }
  }

  async close(): Promise<void> {
    this.opfsAhp?.exit();
  }
}
