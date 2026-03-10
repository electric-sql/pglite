import * as fs from 'fs'
import * as path from 'path'
import { EmscriptenBuiltinFilesystem, PGDATA } from './base.js'
import type { PostgresMod } from '../postgresMod.js'
import { PGlite } from '../pglite.js'

// TODO: Add locking for browser backends via Web Locks API

export class NodeFS extends EmscriptenBuiltinFilesystem {
  protected rootDir: string
  #lockFd: number | null = null

  constructor(dataDir: string) {
    super(dataDir)
    this.rootDir = path.resolve(dataDir)
    if (!fs.existsSync(path.join(this.rootDir))) {
      fs.mkdirSync(this.rootDir)
    }
  }

  async init(pg: PGlite, opts: Partial<PostgresMod>) {
    this.pg = pg

    this.#acquireLock()

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

  // Lock file is a sibling (mydb.lock) to avoid polluting the PG data dir
  #acquireLock() {
    const lockPath = this.rootDir + '.lock'

    if (fs.existsSync(lockPath)) {
      try {
        const content = fs.readFileSync(lockPath, 'utf-8').trim()
        const lines = content.split('\n')
        const pid = parseInt(lines[0], 10)

        if (pid && !isNaN(pid) && this.#isProcessAlive(pid)) {
          throw new Error(
            `PGlite data directory "${this.rootDir}" is already in use by another instance (PID ${pid}). ` +
              `Close the other instance or use a different data directory. ` +
              `Delete "${lockPath}" if PID ${pid} is no longer running.`,
          )
        }
        // Stale lock from a dead process — safe to take over
      } catch (e) {
        // Re-throw lock errors, ignore parse errors (corrupt lock file = stale)
        if (e instanceof Error && e.message.includes('already in use')) {
          throw e
        }
      }
    }

    // Write our PID to the lock file and keep the fd open
    this.#lockFd = fs.openSync(lockPath, 'w')
    fs.writeSync(this.#lockFd, `${process.pid}\n${Date.now()}\n`)
  }

  #releaseLock() {
    if (this.#lockFd !== null) {
      try {
        fs.closeSync(this.#lockFd)
      } catch {
        // Ignore errors on close
      }
      this.#lockFd = null

      const lockPath = this.rootDir + '.lock'
      try {
        fs.unlinkSync(lockPath)
      } catch {
        // Ignore errors on unlink (dir may already be cleaned up)
      }
    }
  }

  #isProcessAlive(pid: number): boolean {
    try {
      process.kill(pid, 0) // signal 0 = check if process exists
      return true
    } catch {
      return false // ESRCH = process doesn't exist
    }
  }

  async closeFs(): Promise<void> {
    this.#releaseLock()
    this.pg!.Module.FS.quit()
  }
}
