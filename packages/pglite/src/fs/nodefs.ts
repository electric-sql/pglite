import * as fs from 'fs'
import * as path from 'path'
import { FilesystemBase } from './types.js'
import { PGDATA } from './index.js'
import type { PostgresMod, FS } from '../postgresMod.js'
import { dumpTar } from './tarUtils.js'

export class NodeFS extends FilesystemBase {
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

  async dumpTar(mod: FS, dbname: string) {
    return dumpTar(mod, dbname)
  }

  async close(FS: FS): Promise<void> {
    FS.quit()
  }
}
