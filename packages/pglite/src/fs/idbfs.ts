import { FilesystemBase } from "./types.js";
import { PGDATA } from "./index.js";
import { copyDir } from "./utils.js";
import type { FS, EmPostgres } from "../../release/postgres.js";
import loadPgShare from "../../release/share.js";
import { initDb } from "../initdb.js";
import { nodeValues } from "../utils.js";
import type { DebugLevel } from "../index.js";

export class IdbFs extends FilesystemBase {
  initModule?: any;

  async init(debug?: DebugLevel) {
    const dbExists = () =>
      new Promise((resolve, reject) => {
        const request = window.indexedDB.open(`/pglite${this.dataDir}`);
        let exists = true;
        request.onupgradeneeded = (e) => {
          if (e.oldVersion === 0) {
            exists = false;
          }
        };
        request.onerror = (e) => {
          resolve(false);
        };
        request.onsuccess = (e) => {
          const db = request.result;
          db.close();
          if (!exists) {
            window.indexedDB.deleteDatabase(`/pglite${this.dataDir}`);
          }
          resolve(exists);
        };
      });

    if (!(await dbExists())) {
      this.initModule = await initDb(undefined, debug);
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
