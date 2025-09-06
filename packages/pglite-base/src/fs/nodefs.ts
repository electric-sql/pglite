import * as fs from 'fs'
import * as path from 'path'
import { EmscriptenBuiltinFilesystem, PGDATA } from './base.js'
import type { PostgresMod } from '../postgresMod.js'
import type { PGliteInterface } from '../interface.js'

export class NodeFS extends EmscriptenBuiltinFilesystem {
  protected rootDir: string

  constructor(dataDir: string) {
    super(dataDir)
    this.rootDir = path.resolve(dataDir)
    if (!fs.existsSync(path.join(this.rootDir))) {
      fs.mkdirSync(this.rootDir)
    }
  }

  async init(pg: PGliteInterface, opts: Partial<PostgresMod>) {
    this.pg = pg
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

  async closeFs(): Promise<void> {
    this.pg!.Module.FS.quit()
  }
}
