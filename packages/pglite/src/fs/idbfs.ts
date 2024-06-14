import { FilesystemBase } from "./types.js";
import type { FS, EmPostgres } from "../../release/postgres.js";

export class IdbFs extends FilesystemBase {
  initModule?: any;

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
          mod.FS.symlink(`/pglite${this.dataDir}`, `/tmp/pglite/base`);
        },
      ],
    };
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
