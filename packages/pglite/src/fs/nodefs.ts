import * as fs from 'fs'
import * as path from 'path'
import { EmscriptenBuiltinFilesystem } from './base.js'
import type { PostgresMod } from '../postgresMod.js'
import { PGlite } from '../pglite.js'
import { pglUtils } from '@electric-sql/pglite-utils'

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
          const nodefs = mod.FS.filesystems.NODEFS
          mod.FS.mkdir(pglUtils.PGDATA)
          mod.FS.mount(nodefs, { root: this.rootDir }, pglUtils.PGDATA)
        },
      ],
    }
    return { emscriptenOpts: options }
  }

  async closeFs(): Promise<void> {
    this.pg!.Module.FS.quit()
  }
}
