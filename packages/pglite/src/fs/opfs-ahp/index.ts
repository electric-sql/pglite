import { FilesystemBase } from "../types.js";
import { PGDATA } from "../index.js";
import type { PostgresMod, FS } from "../../postgresMod.js";
import { createOPFSAHP } from "./emscriptenFs.js";
import { OpfsAhp } from "./opfsAhp.js";
import { dumpTar } from "../tarUtils.js";

export interface OpfsAhpFSOptions {
  initialPoolSize?: number;
  maintainedPoolSize?: number;
}

/**
 * PGlite OPFS access handle pool filesystem.
 * Opens a pool of sync access handles and then allocates them as needed.
 */
export class OpfsAhpFS extends FilesystemBase {
  #initialPoolSize: number;
  #maintainedPoolSize: number;
  opfsAhp?: OpfsAhp;

  constructor(
    dataDir: string,
    { initialPoolSize, maintainedPoolSize }: OpfsAhpFSOptions = {},
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

  async dumpTar(mod: FS, dbname: string) {
    return dumpTar(mod, dbname);
  }

  async close(FS: FS): Promise<void> {
    this.opfsAhp?.exit();
    FS.quit();
  }
}
