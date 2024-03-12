import { FilesystemBase, PGDATA, copyDir } from "./fs.js";
import type { FS, EmPostgres } from "../release/postgres.js";
import loadPgShare from "../release/share.js";
import { initDb } from "./initdb.js";
import { nodeValues } from "./utils.js";
import type { DebugLevel } from "./index.ts";

export class MemoryFS extends FilesystemBase {
  initModule?: any;

  async init(debug?: DebugLevel) {
    this.initModule = await initDb(undefined, debug);
  }

  async emscriptenOpts(opts: Partial<EmPostgres>) {
    const options: Partial<EmPostgres> = {
      ...opts,
      preRun: [
        (mod: any) => {
          /**
           * There is an issue with just mounting the filesystem, Postgres stalls...
           * so we need to copy the files from the memory filesystem to the main fs
           */
          const proxyfs = mod.FS.filesystems.PROXYFS;
          mod.FS.mkdir(PGDATA + "_temp");
          mod.FS.mkdir(PGDATA);
          mod.FS.mount(
            proxyfs,
            { root: PGDATA + "/", fs: this.initModule.FS },
            PGDATA + "_temp",
          );
          copyDir(mod.FS, PGDATA + "_temp", PGDATA);
          mod.FS.unmount(PGDATA + "_temp");
        },
      ],
    };
    const { require } = await nodeValues();
    loadPgShare(options, require);
    return options;
  }
}
