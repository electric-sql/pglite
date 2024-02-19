import { FilesystemBase, PGDATA, copyDir } from "./fs.js";
import type { FS, EmPostgres } from "../release/postgres.js";
import loadPgShare from "../release/share.js";
import { initDb } from "./initdb.js";
import { nodeValues } from "./utils.js";

const PGWASM_URL = new URL("../release/postgres.wasm", import.meta.url);
const PGSHARE_URL = new URL("../release/share.data", import.meta.url);

export class IdbFs extends FilesystemBase {
  initModule?: any;

  async init() {
    console.log("Databases: ", await window.indexedDB.databases());
    const dbExists = (await window.indexedDB.databases())
      .map((db) => db.name)
      .includes(`/pglite${this.dataDir}`);
    console.log("DB exists:", dbExists, this.dataDir);
    if (!dbExists) {
      this.initModule = await initDb();
    }
  }

  async emscriptenOpts(opts: Partial<EmPostgres>) {
    const options: Partial<EmPostgres> = {
      ...opts,
      preRun: [
        (mod: any) => {
          const idbfs = mod.FS.filesystems.IDBFS;
          // Mount the idbfs to the users dataDir
          // then symlink the PGDATA to the idbfs mount
          mod.FS.mkdir(`/pglite`);
          mod.FS.mkdir(`/pglite${this.dataDir}`);
          mod.FS.mount(idbfs, {}, `/pglite${this.dataDir}`);
          mod.FS.symlink(`/pglite${this.dataDir}`, PGDATA);

          if (this.initModule) {
            // We need to copy the files from the memory filesystem to the main fs
            const proxyfs = mod.FS.filesystems.PROXYFS;
            mod.FS.mkdir(PGDATA + "_temp");
            mod.FS.mount(
              proxyfs,
              { root: PGDATA + "/", fs: this.initModule.FS },
              PGDATA + "_temp",
            );
            copyDir(mod.FS, PGDATA + "_temp", PGDATA);
            mod.FS.unmount(PGDATA + "_temp");
          } else {
            mod.FS;
          }
        },
      ],
      locateFile: (base: string, _path: any) => {
        let path = "";
        if (base === "share.data") {
          path = PGSHARE_URL.toString();
        } else if (base === "postgres.wasm") {
          path = PGWASM_URL.toString();
        }
        if (path?.startsWith("file://")) {
          path = path.slice(7);
        }
        return path;
      },
    };
    const { require } = await nodeValues();
    loadPgShare(options, require);
    return options;
  }

  initialSyncFs(fs: FS) {
    if (this.initModule) {
      return this.syncToFs(fs);
    } else {
      return new Promise<void>((resolve, reject) => {
        fs.syncfs(true, (err: any) => {
          if (err) {
            reject(err);
          } else {
            resolve();
          }
        });
      });
    }
  }

  syncToFs(fs: FS) {
    return new Promise<void>((resolve, reject) => {
      console.log("Syncing to fs");
      fs.syncfs((err: any) => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });
  }
}
