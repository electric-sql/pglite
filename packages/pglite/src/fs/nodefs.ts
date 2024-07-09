import * as fs from "fs";
import * as path from "path";
import { FilesystemBase } from "./types.js";
import { PGDATA } from "./index.js";
import type { EmPostgres } from "../postgres.js";

export class NodeFS extends FilesystemBase {
  protected rootDir: string;

  constructor(dataDir: string) {
    super(dataDir);
    this.rootDir = path.resolve(dataDir);
    if (!fs.existsSync(path.join(this.rootDir, "PG_VERSION"))) {
      fs.mkdirSync(this.rootDir);
    }
  }

  async emscriptenOpts(opts: Partial<EmPostgres>) {
    const options: Partial<EmPostgres> = {
      ...opts,
      preRun: [
        ...(opts.preRun || []),
        (mod: any) => {
          const nodefs = mod.FS.filesystems.NODEFS;
          try {
             mod.FS.mkdir(PGDATA);
          } catch (x) {
            console.warn("Path exists :", PGDATA);
          }
          mod.FS.mount(nodefs, { root: this.rootDir }, PGDATA);
        },
      ],
    };
    return options;
  }
}
