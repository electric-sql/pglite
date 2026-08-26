import * as fs from 'fs'
import * as path from 'path'
import { EmscriptenBuiltinFilesystem } from './base.js'
import type { PostgresMod } from '../postgresMod.js'
import { PGlite } from '../pglite.js'
import { PGDATA } from '../initdb.js'

const activeInstances = new Map<string, PGlite>()

// Sequence number to make lock tokens unique within this process.
let lockSeq = 0

export interface NodeFSOptions {
  /**
   * When another PGlite instance in this same process already holds the data
   * directory, close it cleanly and take over instead of throwing. Useful for
   * HMR-style dev servers where a module reload creates a fresh instance and
   * the abandoned old one can no longer be closed. Defaults to false.
   */
  takeover?: boolean
}

export class NodeFS extends EmscriptenBuiltinFilesystem {
  protected rootDir: string
  #lockFd: number | null = null
  #lockToken: string | null = null
  #takeover: boolean

  constructor(dataDir: string, options?: NodeFSOptions) {
    super(dataDir)
    this.rootDir = path.resolve(dataDir)
    this.#takeover = options?.takeover ?? false
    // recursive also makes this atomic: no EEXIST when several processes
    // race to create the same data directory.
    fs.mkdirSync(this.rootDir, { recursive: true })
  }

  async init(pg: PGlite, opts: Partial<PostgresMod>) {
    this.pg = pg

    await this.#acquireLock()

    const options: Partial<PostgresMod> = {
      ...opts,
      preRun: [
        ...(opts.preRun || []),
        (mod: any) => {
          const nodefs = mod.FS.filesystems.NODEFS
          mod.FS.mkdir(PGDATA)
          mod.FS.mount(nodefs, { root: this.rootDir }, PGDATA)
        },
      ],
    }
    return { emscriptenOpts: options }
  }

  async #acquireLock() {
    const lockPath = this.rootDir + '.lock'

    // Another instance in this same process holds the directory.
    // Default: throw, so a double-open fails loudly at the creation site.
    // A manually deleted lock file is treated as an explicit user override.
    // With the takeover option, close the previous instance cleanly (flushes
    // WAL, releases its lock) and claim the directory instead - Node is
    // single threaded, so the close cannot interleave with a write.
    const existing = activeInstances.get(this.rootDir)
    if (existing && !existing.closed && fs.existsSync(lockPath)) {
      if (this.#takeover) {
        console.warn(
          `PGlite: taking over data directory "${this.rootDir}"; the previous instance in this process has been closed.`,
        )
        try {
          await existing.close()
        } catch (e) {
          throw new Error(
            `PGlite data directory "${this.rootDir}" is already in use by another instance in this process ` +
              `and it could not be closed automatically. Close the other instance or use a different data directory. ` +
              `(close failed with: ${e instanceof Error ? e.message : e})`,
          )
        }
      } else {
        throw new Error(
          `PGlite data directory "${this.rootDir}" is already in use by another instance in this process. ` +
            `Close the other instance or use a different data directory.`,
        )
      }
    }

    // Cross-process: acquire by exclusive create ('wx'), which is atomic, so
    // two racing processes can never both succeed. A stale lock (holder PID
    // is dead) is removed under a claim mutex before retrying; see
    // #inspectLock for how live, stale and mid-acquisition locks are told
    // apart.
    const token = `${process.pid}\n${Date.now()}\n${lockSeq++}\n`
    for (let attempt = 0; attempt < 20; attempt++) {
      if (attempt > 0) {
        // Backoff so contenders do not spin through their attempts while
        // another process is still mid-claim or mid-acquisition.
        await new Promise((r) =>
          setTimeout(r, 5 + attempt * 10 * Math.random()),
        )
      }

      try {
        this.#lockFd = fs.openSync(lockPath, 'wx')
        fs.writeSync(this.#lockFd, token)
        this.#lockToken = token
        activeInstances.set(this.rootDir, this.pg!)
        return
      } catch (e) {
        if ((e as NodeJS.ErrnoException)?.code !== 'EEXIST') throw e
      }

      // The lock exists - classify it.
      const seen = this.#inspectLock(lockPath)
      if (seen.state === 'live') {
        throw new Error(
          `PGlite data directory "${this.rootDir}" may be in use by another process (PID ${seen.pid}). ` +
            `Close the other instance or use a different data directory. ` +
            `If PID ${seen.pid} is no longer running or no longer needs pglite, remove or move the stale lock: mv ${lockPath} ${lockPath}.stale.${Date.now()}`,
        )
      }
      if (seen.state !== 'stale') {
        continue // vanished or mid-acquisition; retry after backoff
      }

      // Stale lock (dead holder, our own leftover, or old corrupt file).
      // Removing it must not race a fresh lock written by a new owner, so
      // the removal is guarded by a claim mutex: mkdir is atomic-exclusive,
      // and while the lock file exists no 'wx' writer can replace it -
      // therefore a re-validation under the mutex cannot be invalidated
      // before the unlink.
      const claimPath = lockPath + '.claim'
      try {
        fs.mkdirSync(claimPath)
      } catch {
        // Another process is reclaiming right now. If its mutex is a
        // leftover from a crash mid-claim (a few syscalls wide), clear it
        // once it is clearly old, then retry.
        try {
          if (Date.now() - fs.statSync(claimPath).mtimeMs > 5000) {
            fs.rmdirSync(claimPath)
          }
        } catch {
          // Already cleared by someone else.
        }
        continue
      }

      let busyPid = 0
      try {
        const current = this.#inspectLock(lockPath)
        if (current.state === 'live') {
          busyPid = current.pid // a live owner took it; do not touch
        } else if (current.state === 'stale') {
          try {
            fs.unlinkSync(lockPath)
          } catch {
            // Already removed.
          }
        }
        // 'gone' or 'pending': nothing to remove / not ours to remove.
      } finally {
        try {
          fs.rmdirSync(claimPath)
        } catch {
          // Best effort.
        }
      }
      if (busyPid) {
        throw new Error(
          `PGlite data directory "${this.rootDir}" may be in use by another process (PID ${busyPid}). ` +
            `Close the other instance or use a different data directory.`,
        )
      }
    }

    throw new Error(
      `PGlite could not acquire the lock for data directory "${this.rootDir}" after repeated attempts. ` +
        `Another process may be rapidly creating and releasing locks on it.`,
    )
  }

  /**
   * Classify the current lock file.
   * - 'live':    held by a running process (never touch)
   * - 'stale':   holder is dead, it is our own leftover, or the file is
   *              unparseable AND old (safe to reclaim)
   * - 'pending': unparseable but fresh - a writer is between its exclusive
   *              create and its token write; treat as in use and retry
   * - 'gone':    no lock file
   */
  #inspectLock(lockPath: string): {
    state: 'live' | 'stale' | 'pending' | 'gone'
    pid: number
  } {
    let content: string
    let mtimeMs: number
    try {
      content = fs.readFileSync(lockPath, 'utf-8').trim()
      mtimeMs = fs.statSync(lockPath).mtimeMs
    } catch {
      return { state: 'gone', pid: 0 }
    }
    const pid = parseInt(content.split('\n')[0], 10)
    if (!pid || isNaN(pid)) {
      // No parseable owner. A freshly created lock may simply not have its
      // token written yet ('wx' open and the write are two steps).
      return Date.now() - mtimeMs < 10000
        ? { state: 'pending', pid: 0 }
        : { state: 'stale', pid: 0 }
    }
    if (pid !== process.pid && this.#isProcessAlive(pid)) {
      return { state: 'live', pid }
    }
    return { state: 'stale', pid }
  }

  // A lock left behind by a dead process is stale and safe to reclaim.
  // Reclaiming only ever happens when the holder PID is gone, so PID reuse
  // can at worst make us conservatively refuse a still-live PID - it can
  // never cause us to steal a lock from a running PGlite instance.
  #isProcessAlive(pid: number): boolean {
    try {
      process.kill(pid, 0) // signal 0 only checks for existence
      return true
    } catch (e) {
      // EPERM means the process exists but is owned by another user.
      return (e as NodeJS.ErrnoException)?.code === 'EPERM'
    }
  }

  #releaseLock() {
    // Only deregister if we are still the registered owner; another instance
    // may have legitimately taken over (manually deleted lock or takeover).
    if (activeInstances.get(this.rootDir) === this.pg) {
      activeInstances.delete(this.rootDir)
    }

    if (this.#lockFd !== null) {
      try {
        fs.closeSync(this.#lockFd)
      } catch {
        // The fd may already be invalid; nothing to release.
      }
      this.#lockFd = null

      // Only remove the lock file if it still holds our token, so we never
      // delete a lock that has since been claimed by another owner.
      const lockPath = this.rootDir + '.lock'
      try {
        if (fs.readFileSync(lockPath, 'utf-8') === this.#lockToken) {
          fs.unlinkSync(lockPath)
        }
      } catch {
        // The lock file is already gone or unreadable; nothing to remove.
      }
      this.#lockToken = null
    }
  }

  async closeFs(): Promise<void> {
    // Release the lock only after the filesystem has fully shut down, so
    // another process cannot acquire the directory mid-teardown.
    try {
      this.pg!.Module.FS.quit()
    } finally {
      this.#releaseLock()
    }
  }
}
