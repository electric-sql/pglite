import { EmscriptenBuiltinFilesystem } from './base.js'
import type { PostgresMod } from '../postgresMod.js'
import { PGlite } from '../pglite.js'
import { PGDATA, PG_ROOT } from '../initdb.js'
import { pglUtils } from '@electric-sql/pglite-utils'

export class IdbFs extends EmscriptenBuiltinFilesystem {
  async init(pg: PGlite, opts: Partial<PostgresMod>) {
    this.pg = pg
    const options: Partial<PostgresMod> = {
      ...opts,
      preRun: [
        ...(opts.preRun || []),
        (mod: any) => {
          const idbfs = mod.IDBFS
          // Mount the idbfs to the users dataDir then symlink the PGDATA to the
          // idbfs mount point.
          // We specifically use /pglite as the root directory for the idbfs
          // as the fs will be persisted in the indexeddb as a database with
          // the path as the name.
          mod.FS.mkdirTree(`${PG_ROOT}/${this.dataDir}`)
          // Emscripten's FS.doTruncate does not update the node timestamps,
          // and IDBFS.reconcile only persists a file when its mtime differs
          // from the stored one. Without this, a truncate (e.g. VACUUM
          // shrinking a relation file) is never written back to IndexedDB.
          const doTruncate = mod.FS.doTruncate
          if (typeof doTruncate === 'function') {
            mod.FS.doTruncate = (stream: any, node: any, len: number) => {
              // doTruncate throws on failure, so this only runs on success
              doTruncate.call(mod.FS, stream, node, len)
              node.mtime = node.ctime = Date.now()
            }
          }
          mod.FS.mount(idbfs, {}, `${PG_ROOT}/${this.dataDir}`)
          mod.FS.symlink(`${PG_ROOT}/${this.dataDir}`, PGDATA)
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
    const indexedDb = (this.pg!.Module.IDBFS as pglUtils.IDBFS).dbs[
      this.dataDir!
    ]
    if (indexedDb) {
      indexedDb.close()
    }
    this.pg!.Module.FS.quit()
  }
}
