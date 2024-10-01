import * as fs from 'fs'
import * as path from 'path'
import { EmscriptenBuiltinFilesystem, PGDATA } from './base.js'
import type { PostgresMod, FS } from '../postgresMod.js'

export class NodeFS extends EmscriptenBuiltinFilesystem {
  protected rootDir: string

  constructor(dataDir: string) {
    super(dataDir)
    this.rootDir = path.resolve(dataDir)
    if (!fs.existsSync(path.join(this.rootDir))) {
      fs.mkdirSync(this.rootDir)
    }
  }

  async emscriptenOpts(opts: Partial<PostgresMod>) {
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
    return options
  }

  async closeFs(FS: FS): Promise<void> {
    FS.quit()
  }
}
