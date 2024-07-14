import { FilesystemBase } from "../types.js";
import { PGDATA } from "../index.js";
import type { PostgresMod } from "../../postgres.js";
import { createOPFS } from "./OPFS.js";

export class Opfs extends FilesystemBase {
  #initialHandles: number = 500;
  #maintainedPoolSize: number = 100;

  constructor(dataDir: string) {
    super(dataDir);
  }

  async emscriptenOpts(opts: Partial<PostgresMod>) {
    const options: Partial<PostgresMod> = {
      ...opts,
      preRun: [
        ...(opts.preRun || []),
        (mod: PostgresMod) => {
          const OPFS = createOPFS(mod);
          mod.FS.mkdir(PGDATA);
          mod.FS.mount(
            OPFS,
            {
              root: this.dataDir,
            },
            PGDATA
          );
        },
      ],
    };
    return options;
  }
}
