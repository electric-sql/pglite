import { EmscriptenBuiltinFilesystem } from './base.js'
import type { PostgresMod } from '../postgresMod.js'
import { PGlite } from '../pglite.js'
import { PGDATA, PG_ROOT } from '../initdb.js'

export class IdbFs extends EmscriptenBuiltinFilesystem {
  async init(pg: PGlite, opts: Partial<PostgresMod>) {
    this.pg = pg
    const options: Partial<PostgresMod> = {
      ...opts,
      preRun: [
        ...(opts.preRun || []),
        (mod: any) => {
          const idbfs = mod.FS.filesystems.IDBFS
          // Mount the idbfs to the users dataDir then proxy the PGDATA to the
          // idbfs mount point.
          // We specifically use /pglite as the root directory for the idbfs
          // as the fs will be persisted in the indexeddb as a database with
          // the path as the name.
          // PGDATA must be a real directory rather than a symlink, as initdb
          // reaches it through its own PROXYFS mount, which can't follow a
          // symlink whose target is outside of its filesystem.
          mod.FS.mkdirTree(`${PG_ROOT}/${this.dataDir}`)
          mod.FS.mount(idbfs, {}, `${PG_ROOT}/${this.dataDir}`)
          mod.FS.mount(
            mod.PROXYFS,
            { root: `${PG_ROOT}/${this.dataDir}`, fs: mod.FS },
            PGDATA,
          )
        },
      ],
    }
    return { emscriptenOpts: options }
  }

  initialSyncFs() {
    return new Promise<void>((resolve, reject) => {
      this.pg!.Module.FS.syncfs(true, (err: any) => {
        if (err) {
          reject(err)
        } else {
          resolve()
        }
      })
    })
  }

  syncToFs(_relaxedDurability?: boolean) {
    return new Promise<void>((resolve, reject) => {
      this.pg!.Module.FS.syncfs(false, (err: any) => {
        if (err) {
          reject(err)
        } else {
          resolve()
        }
      })
    })
  }

  async closeFs(): Promise<void> {
    // IDBDatabase.close() method is essentially async, but returns immediately,
    // the database will be closed when all transactions are complete.
    // This needs to be handled in application code if you want to delete the
    // database after it has been closed. If you try to delete the database
    // before it has fully closed it will throw a blocking error.
    const indexedDb = this.pg!.Module.FS.filesystems.IDBFS.dbs[this.dataDir!]
    if (indexedDb) {
      indexedDb.close()
    }
    this.pg!.Module.FS.quit()
  }
}
