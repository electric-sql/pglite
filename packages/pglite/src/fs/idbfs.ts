import { FilesystemBase } from "./types.js";
import type { FS, EmPostgres } from "../../release/postgres.js";

export class IdbFs extends FilesystemBase {
  async emscriptenOpts(opts: Partial<EmPostgres>) {
    const options: Partial<EmPostgres> = {
      ...opts,
      preRun: [
        (mod: any) => {
          const idbfs = mod.FS.filesystems.IDBFS;
          // Mount the idbfs to PGDATA in auto commit mode
          mod.FS.mkdir(`/tmp/pglite/${this.dataDir}`);
          mod.FS.mount(idbfs, {autoPersist: false}, `/tmp/pglite/${this.dataDir}`);
        },
      ],
    };
    return options;
  }

  initialSyncFs(fs: FS) {
    return new Promise<void>((resolve, reject) => {
      console.log("Syncing from idbfs to fs");
      fs.syncfs(true, (err: any) => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });
  }

  syncToFs(fs: FS) {
    return new Promise<void>((resolve, reject) => {
      console.log("Syncing from fs to idbfs");
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
