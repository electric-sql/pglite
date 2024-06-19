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
          // Mount the idbfs to PGDATA in auto commit mode
          mod.FS.mkdir(`/tmp/pglite/${this.dataDir}`);
          mod.FS.mount(idbfs, {autoPersist: true}, `/tmp/pglite/${this.dataDir}`);
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
      fs.syncfs(false, (err: any) => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });
  }
}
