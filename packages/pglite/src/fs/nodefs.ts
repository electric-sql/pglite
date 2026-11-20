import * as fs from 'fs'
import * as path from 'path'
import { EmscriptenBuiltinFilesystem, normalizePgDataPath } from './base.js'
import type { PostgresMod } from '../postgresMod.js'
import { PGlite } from '../pglite.js'
import { PGDATA } from '../initdb.js'

export class NodeFS extends EmscriptenBuiltinFilesystem {
  protected rootDir: string

  constructor(dataDir: string) {
    super(dataDir)
    this.rootDir = path.resolve(dataDir)
    if (!fs.existsSync(path.join(this.rootDir))) {
      fs.mkdirSync(this.rootDir)
    }
  }

  async init(pg: PGlite, opts: Partial<PostgresMod>) {
    this.pg = pg
    const options: Partial<PostgresMod> = {
      ...opts,
      preRun: [
        ...(opts.preRun || []),
        (mod: any) => {
          const nodefs = mod.NODEFS
          mod.FS.mkdirTree(PGDATA)
          mod.FS.mount(nodefs, { root: this.rootDir }, PGDATA)
        },
      ],
    }
    return { emscriptenOpts: options }
  }

  async existsInPgData(relPath: string): Promise<boolean> {
    // NODEFS passes straight through to the host directory
    return fs.existsSync(path.join(this.rootDir, normalizePgDataPath(relPath)))
  }

  async closeFs(): Promise<void> {
    this.pg!.Module.FS.quit()
  }
}
