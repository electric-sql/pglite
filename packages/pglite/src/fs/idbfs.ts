import { FilesystemBase } from "./types.js";
import type { FS, PostgresMod } from "../postgres.js";
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

  async dumpTar(mod: FS) {
    return dumpTar(mod);
  }
}
