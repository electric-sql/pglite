import { EmscriptenBuiltinFilesystem, normalizePgDataPath } from './base.js'
import type { PostgresMod } from '../postgresMod.js'
import { PGlite } from '../pglite.js'
import { PGDATA, PG_ROOT } from '../initdb.js'
import { pglUtils } from '@electric-sql/pglite-utils'

// Must match emscripten's IDBFS
const IDBFS_STORE_NAME = 'FILE_DATA'

export class IdbFs extends EmscriptenBuiltinFilesystem {
  // Set once initialSyncFs has loaded IndexedDB into the in-memory FS
  #loaded = false

  /**
   * The IDBFS mount point, which is also the name of the IndexedDB database
   * and the prefix of its keys.
   */
  get #mountPoint() {
    return normalizeAbsPath(`${PG_ROOT}/${this.dataDir}`)
  }

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
          this.#loaded = true
          resolve()
        }
      })
    })
  }

  async existsInPgData(relPath: string): Promise<boolean> {
    if (this.#loaded) {
      // The in-memory FS is the source of truth, IndexedDB lags behind it
      // until the next syncToFs
      return super.existsInPgData(relPath)
    }
    return idbKeyExists(
      this.#mountPoint,
      this.#mountPoint + normalizePgDataPath(relPath),
    )
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

function normalizeAbsPath(path: string): string {
  return '/' + path.split('/').filter(Boolean).join('/')
}

/**
 * Check whether `key` is in the IDBFS store of database `dbName`, without
 * creating the database if it doesn't exist.
 */
function idbKeyExists(dbName: string, key: string): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const req = globalThis.indexedDB.open(dbName)
    let created = false
    req.onupgradeneeded = () => {
      // The database doesn't exist, aborting the upgrade discards it again
      created = true
      req.transaction!.abort()
    }
    req.onerror = (e) => {
      if (created) {
        e.preventDefault()
        resolve(false)
      } else {
        reject(req.error)
      }
    }
    req.onsuccess = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(IDBFS_STORE_NAME)) {
        db.close()
        resolve(false)
        return
      }
      try {
        const tx = db.transaction(IDBFS_STORE_NAME, 'readonly')
        const countReq = tx.objectStore(IDBFS_STORE_NAME).count(key)
        tx.oncomplete = () => {
          db.close()
          resolve(countReq.result > 0)
        }
        tx.onerror = tx.onabort = () => {
          db.close()
          reject(tx.error)
        }
      } catch (e) {
        db.close()
        reject(e)
      }
    }
  })
}
