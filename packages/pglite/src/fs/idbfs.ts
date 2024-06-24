import { FilesystemBase } from "./types.js";
import type { FS, EmPostgres } from "../../release/postgres.js";
import { PGDATA } from "./index.js";

export class IdbFs extends FilesystemBase {
  async emscriptenOpts(opts: Partial<EmPostgres>) {
    const options: Partial<EmPostgres> = {
      ...opts,
      preRun: [
        (mod: any) => {
          //const idbfs = mod.FS.filesystems.IDBFS;
          const idbfs = mod.FS.filesystems.PGFS;
          // Mount the idbfs to the users dataDir then symlink the PGDATA to the
          // idbfs mount point.
          // We specifically use /pglite as the root directory for the idbfs
          // as the fs will ber persisted in the indexeddb as a database with
          // the path as the name.
          mod.FS.mkdir(`/pglite`);
          mod.FS.mkdir(`/pglite/${this.dataDir}`);
          mod.FS.mount(idbfs, {}, `/pglite/${this.dataDir}`);
          mod.FS.symlink(`/pglite/${this.dataDir}`, PGDATA);
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

/*
    on_mount() {
    }

    load_extension(ext) {
    }

*/
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
