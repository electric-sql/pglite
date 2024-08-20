import { FilesystemBase } from './types.js'
import type { PostgresMod, FS } from '../postgresMod.js'
import { dumpTar, type DumpTarCompressionOptions } from './tarUtils.js'

export class MemoryFS extends FilesystemBase {
  async emscriptenOpts(opts: Partial<PostgresMod>) {
    // Nothing to do for memoryfs
    return opts
  }

  async dumpTar(
    mod: FS,
    dbname: string,
    compression?: DumpTarCompressionOptions,
  ) {
    return dumpTar(mod, dbname, compression)
  }

  async close(FS: FS): Promise<void> {
    FS.quit()
  }
}
