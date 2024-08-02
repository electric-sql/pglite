import { FilesystemBase } from "./types.js";
import type { FS, PostgresMod } from "../postgresMod.js";
import { PGDATA } from "./index.js";
import { dumpTar } from "./tarUtils.js";

export class IdbFs extends FilesystemBase {
  async emscriptenOpts(opts: Partial<PostgresMod>) {
    const options: Partial<PostgresMod> = {
      ...opts,
      preRun: [
        ...(opts.preRun || []),
        (mod: any) => {
          const idbfs = mod.FS.filesystems.IDBFS;
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

  syncToFs(fs: FS, relaxedDurability?: boolean) {
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

  async dumpTar(mod: FS, dbname: string) {
    return dumpTar(mod, dbname);
  }

  async close(FS: FS): Promise<void> {
    // IDBDatabase.close() method is essentially async, but returns immediately,
    // the database will be closed when all transactions are complete.
    // This needs to be handled in application code if you want to delete the
    // database after it has been closed. If you try to delete the database
    // before it has fully closed it will throw a blocking error.
    const indexedDb = FS.filesystems.IDBFS.dbs[this.dataDir!];
    if (indexedDb) {
      indexedDb.close();
    }
    FS.quit();
  }
}
