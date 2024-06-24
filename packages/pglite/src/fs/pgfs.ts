import { FilesystemBase } from "./types.js";
import type { FS, EmPostgres } from "../../release/postgres.js";
import { PGDATA } from "./index.js";

export class PgFs extends FilesystemBase {
  //initModule?: any;

  async emscriptenOpts(opts: Partial<EmPostgres>) {
    const options: Partial<EmPostgres> = {
      ...opts,
      preRun: [
        (mod: any) => {
          const pgfs = mod.FS.filesystems.PGFS;
          // Mount the pgfs to PGDATA in auto commit mode
          mod.FS.mkdir(PGDATA);
          mod.FS.mount(pgfs, {autoPersist: true}, `/tmp/pglite/${this.dataDir}`);
        },
      ],
    };
    return options;
  }

  initialSyncFs(fs: FS) {
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
