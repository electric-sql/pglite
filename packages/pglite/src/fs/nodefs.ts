import * as fs from "fs";
import * as path from "path";
import { FilesystemBase } from "./types.js";
import { PGDATA } from "./index.js";
import type { EmPostgres } from "../../release/postgres.js";
import type { DebugLevel } from "../index.js";

export class NodeFS extends FilesystemBase {
  protected rootDir: string;

  constructor(dataDir: string) {
    super(dataDir);
    this.rootDir = path.resolve(dataDir);
  }

  async init(debug?: DebugLevel) {
    if (!this.dataDir) {
      throw new Error("No datadir specified");
    }
    if (fs.existsSync(path.join(this.dataDir!, "PG_VERSION"))) {
      return false;
    }
    fs.mkdirSync(this.dataDir);
    return true;
  }

  async emscriptenOpts(opts: Partial<EmPostgres>) {
    const options: Partial<EmPostgres> = {
      ...opts,
      preRun: [
        (mod: any) => {
          const nodefs = mod.FS.filesystems.NODEFS;
          mod.FS.mkdir(PGDATA);
          mod.FS.mount(nodefs, { root: this.rootDir }, PGDATA);
        },
      ],
    };
    return options;
  }
}
