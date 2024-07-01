import { FilesystemBase } from "./types.js";
import type { FS, EmPostgres } from "../postgres.js";
import { PGDATA, loadExtensions } from "./index.js";

export class PgFs extends FilesystemBase {
  //initModule?: any;

  async emscriptenOpts(opts: Partial<EmPostgres>) {
    const options: Partial<EmPostgres> = {
      ...opts,
      preRun: [
        (mod: any) => {

    /* @ts-ignore */
    globalThis.window.Module = mod;


          const pgfs = mod.FS.filesystems.IDBFS;
          // Mount the pgfs to PGDATA in auto commit mode
          mod.FS.mkdir(PGDATA);
          console.log("mounting pgfs");
          mod.FS.mount(pgfs, {autoPersist: false}, `/tmp/pglite/${this.dataDir}`);
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
          loadExtensions("pgfs", fs);
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
